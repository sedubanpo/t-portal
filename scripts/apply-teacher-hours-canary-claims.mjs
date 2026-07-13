#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { TEACHER_HOURS_CANARY_USERS } from './teacher-hours-canary-users.mjs';

const require = createRequire(import.meta.url);
const admin = require('/Users/anjongseong/Documents/New project/s-lms/node_modules/firebase-admin');
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT
  || '/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json';
const serviceAccount = require(serviceAccountPath);
const apply = process.argv.includes('--apply');
const confirmation = (process.argv.find(arg => arg.startsWith('--confirm=')) || '').slice('--confirm='.length);

if (apply && confirmation !== 'EXPAND_TEACHER_HOURS_CANARY_31') {
  throw new Error('적용하려면 --confirm=EXPAND_TEACHER_HOURS_CANARY_31 확인값이 필요합니다.');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'fir-lms-prod'
});

try {
  const users = await Promise.all(TEACHER_HOURS_CANARY_USERS.map(item => admin.auth().getUser(item.uid)));
  const checks = users.map((user, index) => {
    const expected = TEACHER_HOURS_CANARY_USERS[index];
    return {
      uid: expected.uid,
      teacherName: expected.teacherName,
      actualDisplayName: String(user.displayName || '').trim(),
      disabled: user.disabled === true,
      currentRole: String(user.customClaims?.role || ''),
      needsUpdate: user.customClaims?.role !== 'authenticated'
    };
  });

  const disabled = checks.filter(item => item.disabled);
  const nameMismatches = checks.filter(item => item.actualDisplayName !== item.teacherName);
  assert.equal(disabled.length, 0, `비활성 Firebase 계정이 포함되어 있습니다: ${disabled.map(item => item.uid).join(', ')}`);
  assert.equal(nameMismatches.length, 0, `Firebase 표시명 불일치: ${nameMismatches.map(item => `${item.uid}:${item.actualDisplayName}`).join(', ')}`);

  if (apply) {
    for (let index = 0; index < users.length; index += 1) {
      const user = users[index];
      if (user.customClaims?.role === 'authenticated') continue;
      await admin.auth().setCustomUserClaims(user.uid, {
        ...(user.customClaims || {}),
        role: 'authenticated'
      });
    }
  }

  const verifiedUsers = await Promise.all(TEACHER_HOURS_CANARY_USERS.map(item => admin.auth().getUser(item.uid)));
  const authenticatedCount = verifiedUsers.filter(user => user.customClaims?.role === 'authenticated').length;
  console.log(JSON.stringify({
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    total: checks.length,
    updateCount: checks.filter(item => item.needsUpdate).length,
    authenticatedCount,
    disabledCount: disabled.length,
    nameMismatchCount: nameMismatches.length
  }, null, 2));
} finally {
  await admin.app().delete();
}

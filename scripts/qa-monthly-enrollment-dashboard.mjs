import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire('/Users/anjongseong/Documents/New project/s-lms/package.json');
const { chromium } = require('playwright');
const outputDir = process.argv[2];
if (!outputDir) throw new Error('evidence output directory is required');
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function capture(name, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderStudentMonthlyStatsDashboard === 'function');
  await page.evaluate(() => {
    const lesson = (teacher, hours = 2) => ({ teacher, hours, status: '출석' });
    const student = (id, name, teacher, school, grade) => ({
      statsSchemaVersion: 'v291', key: `id:${id}`, canonicalStudentId: id, student: name,
      school, grade, totalCount: 1, attendedCount: 1, teachers: { [teacher]: 1 }, rows: [lesson(teacher)]
    });
    const teachers = ['안준성','박은채','이영재','송경석','정지호','남종언'];
    const names = ['정준우','장민우','김하율','정승원','김동현b','김윤찬','김윤지','최민준b','김나린','장민재','장지우','정준민','손견아','최시영','김현중','김가연','김나현','문찬영','백송연','최한별'];
    const entries = [];
    for (let offset = 12; offset >= 0; offset--) {
      const date = new Date(2026, 7 - offset, 1);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
      const count = 96 + (12 - offset) * 2 + [0,2,-1,3,-2,1,0,4,-1,2,1,3,2][12-offset];
      const rows = [];
      for (let i = 0; i < count; i++) {
        const name = names[i % names.length] + (i >= names.length ? String(Math.floor(i / names.length) + 1) : '');
        rows.push(student(`${monthKey}-${i}`, name, teachers[i % teachers.length], i % 6 === 0 ? '세화여중' : '반포고', String((i % 3) + 1)));
      }
      entries.push({ monthKey, loaded: true, rows });
    }
    // 계속생/활성 해제/신규가 화면에 함께 나타나도록 마지막 두 달의 일부 ID를 공유한다.
    const prev = entries[11].rows;
    const curr = entries[12].rows;
    for (let i = 0; i < Math.min(104, prev.length, curr.length); i++) {
      curr[i].canonicalStudentId = prev[i].canonicalStudentId;
      curr[i].key = prev[i].key;
      curr[i].student = prev[i].student;
    }
    document.body.classList.add('admin-mode', 'dashboard-active');
    const modal = document.getElementById('student-monthly-stats-modal');
    modal.style.display = 'flex';
    document.getElementById('sem-month-picker').value = '2026-08';
    const model = window.buildMonthlyEnrollmentDashboardModel(entries, '2026-08');
    window.renderStudentMonthlyStatsDashboard(model);
  });
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: false });
  const metrics = await page.evaluate(() => {
    const modal = document.querySelector('#student-monthly-stats-modal .modal-sheet');
    const content = document.getElementById('sem-content');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      modal: { width: modal.clientWidth, height: modal.clientHeight, scrollWidth: modal.scrollWidth, scrollHeight: modal.scrollHeight },
      content: { width: content.clientWidth, height: content.clientHeight, scrollWidth: content.scrollWidth, scrollHeight: content.scrollHeight },
      kpis: document.querySelectorAll('.sem-kpi').length,
      teacherRows: document.querySelectorAll('.sem-teacher-row:not(.head)').length
    };
  });
  fs.writeFileSync(path.join(outputDir, `${name}.json`), JSON.stringify(metrics, null, 2));
  await page.close();
}

await capture('desktop-1440x1000', { width: 1440, height: 1000 });
await capture('mobile-390x844', { width: 390, height: 844 });
await browser.close();
console.log(JSON.stringify({ ok: true, outputDir }, null, 2));

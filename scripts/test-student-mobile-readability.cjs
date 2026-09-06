// Isolated visual fixture: production CSS/markup/functions, synthetic student only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.PLAYWRIGHT_MODULES || '/Users/anjongseong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const extract = name => {
  const start = source.indexOf('  function ' + name + '(');
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n  function ', start + 1));
};
const modal = source.slice(source.indexOf('<div id="student-stats-modal"'), source.indexOf('<div id="student-monthly-stats-modal"'));
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  try {
    const page = await browser.newPage();
    const fonts = (source.match(/<link[^>]+rel="stylesheet"[^>]*>/g) || []).join('');
    await page.setContent(fonts + source.match(/<style>[\s\S]*?<\/style>/)[0] + modal);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      document.querySelector('#student-stats-modal').style.display = 'flex';
      document.querySelector('#stats-month-picker').value = '2026-09';
      document.querySelector('#stats-month-picker-inline').value = '2026-09';
      window.escapeHtml_ = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;');
      window.statsLessonClassFilter = null;
      window.buildStatsTopSchoolHintChip = () => '<span class="sdb-filter-chip hint">강사 선택 시 주요 담당 학교 표시</span>';
      window.filterAndRenderStats = () => window.renderStatsActiveFilters();
      window.clearStatsFilter = id => { document.getElementById(id).value='All'; window.renderStatsActiveFilters(); };
      window.statsSelectedStudents = new Set();
      window.renderStatsTeacherChips = () => '<span class="sdb-teacher-chip">검토강사</span>';
      window.renderStatsSubjectChips = () => '<span class="sdb-subject-chip math">수학 4회</span>';
      window.renderStatsStudentActions = () => '<button type="button">상세 보기</button>';
    });
    await page.addScriptTag({content: ['toggleStatsDetailFilters','renderStatsActiveFilters','renderStudentStatsRow'].map(extract).join('\n')});
    await page.evaluate(() => {
      document.querySelector('#stats-list-container').innerHTML = renderStudentStatsRow({student:'검토 학생',key:'fixture',schoolLine:'가독성검토중학교 · 3학년',level:'중등',recentText:'9/5 수학 2시간',totalCount:4,riskClass:'normal',riskLabel:'정상'},4);
      document.querySelector('.sdb-table-card').classList.add('mode-students');
      renderStatsActiveFilters();
    });
    for (const width of [390, 767, 768, 1280]) {
      await page.setViewportSize({width,height:844});
      const mobile = width < 768;
      assert.equal(await page.locator('#stats-detail-filters').isVisible(), !mobile);
      const row = await page.locator('.sdb-row').boundingBox();
      if (mobile) {
        assert(row.y < 620, `first row too low at ${width}: ${row.y}`);
        assert(row.x + row.width <= width, 'row overflows');
        assert.equal(await page.locator('#stats-month-picker-inline').isVisible(), false);
      }
      if(out) await page.screenshot({path:path.join(out,`students-${width}.png`)});
    }
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:/상세 필터/}).click();
    assert.equal(await page.locator('#stats-filter-toggle').getAttribute('aria-expanded'),'true');
    await page.locator('#filter-level').selectOption('중등');
    assert.match(await page.locator('#stats-detail-filter-count').innerText(),/1개 적용/);
    if(out) await page.screenshot({path:path.join(out,'students-expanded.png')});
    await page.getByRole('button',{name:/상세 필터/}).click();
    assert.equal(await page.locator('#stats-detail-filters').isVisible(),false);
    assert.match(await page.locator('#stats-active-filters').innerText(),/학교급: 중등/);
    await page.setViewportSize({width:1280,height:844});
    assert.equal(await page.locator('#stats-detail-filters').isVisible(),true);
    assert.equal(await page.locator('#filter-level').inputValue(),'중등');
    await page.setViewportSize({width:390,height:844});
    await page.locator('#stats-active-filters button').click();
    assert.equal(await page.locator('#filter-level').inputValue(),'All');
    assert.equal(await page.locator('#stats-detail-filter-count').innerText(),'');
    console.log('PASS mobile disclosure, retained filters, clear chip, 390/767/768/1280 layout');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });

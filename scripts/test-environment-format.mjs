import assert from 'node:assert/strict';

export function runEnvironmentFormatTests(api) {
  const template = api.DEFAULT_FORMAT_GUIDES.formatGuide.timeDateWeather;
  const dates = { MDY: 'August 15, 2024', DMY: '15 August 2024', YMD: '2024-08-15' };
  for (const [dateFormat, dateExample] of Object.entries(dates)) {
    for (const timeFormat of ['12h', '24h']) {
      for (const tempUnit of ['C', 'F']) {
        const settings = { dateFormat, timeFormat, tempUnit };
        const guide = api.formatMochiEnvironmentGuide(template, settings);
        const timeExample = timeFormat === '12h' ? 'h:mm AM/PM' : 'hh:mm';
        const label = `${dateFormat}/${timeFormat}/${tempUnit}`;
        assert.ok(guide.includes(`date: {{Date}}     #Format: ${dateExample}`), label);
        assert.ok(guide.includes(`time: {{Time}}     #Most recent time, Format: ${timeExample}`), label);
        assert.ok(guide.includes(`temperature: {{Temperature}}     #Format: 78°${tempUnit}`), label);
        assert.equal(api.formatMochiEnvironmentGuide(guide, settings), guide, `${label} is idempotent`);
        assert.equal(api.formatMochiEnvironmentGuide(guide, { dateFormat: 'MDY', timeFormat: '12h', tempUnit: 'F' }), template, `${label} can switch back`);
      }
    }
  }

  const settings = { dateFormat: 'YMD', timeFormat: '24h', tempUnit: 'C' };
  const custom = '# Keep my instructions and {{user}} macro\r\n<environment>\r\n'
    + 'date: {{Date}} #Format: February 29, 2024 # use the story calendar\r\n'
    + 'time: {{Time}} #Most recent time, Format: h:mm AM/PM # local time\r\n'
    + 'temperature: {{Temperature}} #Format: -3.5°F # no conversion of this example\r\n'
    + 'weather: {{Weather}} # unchanged\r\n</environment>';
  assert.equal(api.formatMochiEnvironmentGuide(custom, settings), custom
    .replace('February 29, 2024', '2024-02-29').replace('h:mm AM/PM', 'hh:mm').replace('-3.5°F', '-3.5°C'));
  const customWithoutExamples = 'date: Day of the dragon #Format: fictional calendar\n'
    + 'time: dusk # use narrative time\ntemperature: warm\n';
  assert.equal(api.formatMochiEnvironmentGuide(customWithoutExamples, settings), customWithoutExamples);
  assert.equal(api.formatMochiEnvironmentGuide('', settings), '', 'Disabled guides stay empty');

  assert.equal(api.normalizeMochiOsSettings({ theme: 'dark' }).dateFormat, 'MDY', 'Older settings keep the original date style');
  for (const dateFormat of Object.keys(dates)) {
    assert.equal(api.normalizeMochiOsSettings({ dateFormat }).dateFormat, dateFormat);
  }
  const instant = new Date('2024-08-15T00:30:00Z');
  assert.equal(api.formatMochiDate(instant, 'MDY', 'UTC'), 'August 15, 2024');
  assert.equal(api.formatMochiDate(instant, 'DMY', 'UTC'), '15 August 2024');
  assert.equal(api.formatMochiDate(instant, 'YMD', 'America/Los_Angeles'), '2024-08-14');
  for (const date of Object.values(dates)) {
    assert.equal(api.formatMochiDate(api.parseMochiDate(date), 'YMD'), '2024-08-15', 'Reformatting an AI calendar date does not move it to another day');
  }
  assert.equal(api.parseMochiDate('2024-02-30'), null);
  assert.equal(api.parseMochiDate('Today'), null, 'Fictional and relative dates remain usable as text');
  console.log('PASS: all date/time/unit guide combinations, reversible hints, custom instructions, legacy settings, and timezone-safe calendar dates');
}

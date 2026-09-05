import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

// Публичная ссылка на XLSX в Облаке Mail.ru.
const PUBLIC_URL =
  'https://cloud.mail.ru/public/KRh4/Q5UoGDxkv/%D0%91%D0%94%20%D0%AD%D0%BA%D0%91%20%D0%9E%D0%98%D0%A1%D0%B8%D0%A0%20%D0%A0%D0%A3%D0%9F%D0%9E%20%D0%98%D0%A1%D0%98%D0%9F%20%D0%9E%D0%98%D0%91%D0%90%D0%A1.xlsx';

const OUTPUT_PATH = path.resolve(import.meta.dirname, '..', 'site', 'data', 'schedule.json');
const FIRST_GROUP_COL = 4;  // D
const LAST_GROUP_COL = 90; // CL, 23 группы × 4 колонки

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function cell(rows, row, col) {
  return rows[row - 1]?.[col - 1] ?? '';
}

function isGroupHeader(rows, row) {
  return clean(cell(rows, row, 3)).toLowerCase() === 'группа:' &&
         clean(cell(rows, row + 1, 3)).toLowerCase() === 'подгруппа:';
}

function getGroups(rows, headerRow) {
  const groups = [];

  for (let col = FIRST_GROUP_COL; col <= LAST_GROUP_COL; col += 4) {
    const name = clean(cell(rows, headerRow, col));
    if (!name) continue;

    groups.push({
      name,
      course: (name.match(/^(\d+)/) || [])[1] || null,
      specialty: clean(name.replace(/^\d+\s*/, '').replace(/\s+[А-ЯA-Z]\s*$/i, '')),
      subgroups: [
        clean(cell(rows, headerRow + 1, col)) || null,
        clean(cell(rows, headerRow + 1, col + 2)) || null,
      ],
      baseCol: col,
    });
  }

  return groups;
}

function parseBlock(rows, headerRow, nextHeaderRow) {
  const groups = getGroups(rows, headerRow);
  const days = [];
  let currentDay = null;

  for (let row = headerRow + 2; row < nextHeaderRow; row++) {
    const dayLabel = clean(cell(rows, row, 1));
    if (dayLabel && /\d{1,2}\.\d{2}/.test(dayLabel)) {
      currentDay = {
        label: dayLabel,
        lessons: [],
      };
      days.push(currentDay);
    }

    const numberRaw = cell(rows, row, 2);
    const time = clean(cell(rows, row, 3));

    if (!currentDay || !time || !/^\d+$/.test(String(numberRaw ?? '').trim())) {
      continue;
    }

    const number = Number(numberRaw);
    const teacherRow = row + 1;

    const entries = [];
    for (const group of groups) {
      const col = group.baseCol;

      // В обычном случае предмет/преподаватель находятся в первой колонке
      // 4-колоночного блока. Если Excel разделил подгруппы — читаем обе.
      const subjects = [
        clean(cell(rows, row, col)),
        clean(cell(rows, row, col + 2)),
      ];
      const teachers = [
        clean(cell(rows, teacherRow, col)),
        clean(cell(rows, teacherRow, col + 2)),
      ];
      const room1 = clean(cell(rows, row, col + 3));
      const room2 = clean(cell(rows, teacherRow, col + 3));

      const hasSecond = subjects[1] || teachers[1];
      const variants = hasSecond ? [0, 1] : [0];

      for (const index of variants) {
        const subject = subjects[index] || subjects[0];
        const teacher = teachers[index] || teachers[0];
        const room = (index === 1 ? room2 || room1 : room1) || null;

        if (!subject && !teacher && !room) continue;

        entries.push({
          group: group.name,
          subgroup: group.subgroups[index] || group.subgroups[0] || null,
          subject: subject || null,
          teacher: teacher || null,
          room,
        });
      }
    }

    currentDay.lessons.push({
      number,
      time,
      entries,
    });
  }

  return { groups, days };
}

function parseSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerRows = [];
  for (let row = 1; row < rows.length; row++) {
    if (isGroupHeader(rows, row)) headerRows.push(row);
  }

  const blocks = [];
  for (let i = 0; i < headerRows.length; i++) {
    const headerRow = headerRows[i];
    const nextHeaderRow = headerRows[i + 1] || rows.length + 1;
    blocks.push(parseBlock(rows, headerRow, nextHeaderRow));
  }

  const groups = [];
  const groupSeen = new Set();
  const days = [];

  for (const block of blocks) {
    for (const group of block.groups) {
      if (!groupSeen.has(group.name)) {
        groupSeen.add(group.name);
        groups.push({ ...group, baseCol: undefined });
      }
    }
    days.push(...block.days);
  }

  return { groups, days };
}

async function getDirectDownloadUrl(publicUrl) {
  const match = publicUrl.match(/\/public\/(.+)$/);
  if (!match) throw new Error('Некорректная публичная ссылка Mail.ru');

  const dispatcherRes = await fetch('https://cloud.mail.ru/api/v2/dispatcher');
  if (!dispatcherRes.ok) {
    throw new Error(`Mail.ru dispatcher: HTTP ${dispatcherRes.status}`);
  }

  const dispatcher = await dispatcherRes.json();
  const baseUrl = dispatcher?.body?.weblink_get?.[0]?.url;
  if (!baseUrl) {
    throw new Error('Mail.ru не вернул URL скачивания (weblink_get)');
  }

  return baseUrl + match[1];
}

async function downloadXlsx() {
  console.log('Получаю прямую ссылку Mail.ru...');
  const directUrl = await getDirectDownloadUrl(PUBLIC_URL);

  console.log('Скачиваю XLSX...');
  const response = await fetch(directUrl);
  if (!response.ok) {
    throw new Error(`Не удалось скачать XLSX: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1000) throw new Error('Mail.ru вернул слишком маленький файл');
  return buffer;
}

async function main() {
  const buffer = await downloadXlsx();

  console.log('Разбираю XLSX...');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: false });

  const weeks = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const parsed = parseSheet(sheet);

    return {
      name: clean(sheetName),
      groups: parsed.groups,
      days: parsed.days,
    };
  });

  const totalLessons = weeks.reduce(
    (sum, week) => sum + week.days.reduce((n, day) => n + day.lessons.length, 0),
    0,
  );

  if (!weeks.length || totalLessons === 0) {
    throw new Error('В XLSX не найдено ни одной пары. JSON не перезаписываю.');
  }

  const output = {
    version: 2,
    updatedAt: new Date().toISOString(),
    sourceUrl: PUBLIC_URL,
    weeks,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  const groupCount = new Set(
    weeks.flatMap((week) => week.groups.map((group) => group.name)),
  ).size;

  console.log(`Готово: ${weeks.length} недель, ${groupCount} групп, ${totalLessons} пар.`);
  console.log(`Файл: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});

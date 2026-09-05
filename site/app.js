const DATA_URL = 'data/schedule.json';

let scheduleData = null;
let teacherIndex = new Map();
let groupIndex = new Map();

const appEl = document.getElementById('app');
const updatedEl = document.getElementById('updatedLine');

function initTheme() {
  const saved = localStorage.getItem('theme');
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeToggleLabel(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeToggleLabel(next);
}

function updateThemeToggleLabel(theme) {
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);

async function loadData() {
  const res = await fetch(DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);

  scheduleData = await res.json();

  if (!Array.isArray(scheduleData.weeks)) {
    throw new Error('schedule.json имеет старый или неизвестный формат');
  }

  buildIndexes();
  updatedEl.textContent = formatUpdated(scheduleData.updatedAt);
}

function formatUpdated(iso) {
  if (!iso) return 'расписание ещё не обновлялось автоматически';

  const d = new Date(iso);
  return 'обновлено: ' + d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildIndexes() {
  teacherIndex = new Map();
  groupIndex = new Map();

  for (const week of scheduleData.weeks) {
    for (const group of week.groups || []) {
      if (!groupIndex.has(group.name)) {
        groupIndex.set(group.name, {
          name: group.name,
          course: group.course,
          specialty: group.specialty,
          subgroups: group.subgroups || [],
        });
      }
    }

    for (const day of week.days || []) {
      for (const lesson of day.lessons || []) {
        for (const entry of lesson.entries || []) {
          if (!entry.teacher) continue;

          if (!teacherIndex.has(entry.teacher)) {
            teacherIndex.set(entry.teacher, []);
          }

          teacherIndex.get(entry.teacher).push({
            week: week.name,
            day: day.label,
            number: lesson.number,
            time: lesson.time,
            ...entry,
          });
        }
      }
    }
  }
}

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (!hash) return { view: 'home', param: null, extra: null };

  const parts = hash.split('/');
  const view = parts.shift() || 'home';
  const param = parts.length ? decodeURIComponent(parts.shift()) : null;
  const extra = parts.length ? decodeURIComponent(parts.join('/')) : null;

  return { view, param, extra };
}

function navigate(hash) {
  location.hash = hash;
}

window.addEventListener('hashchange', render);

function render() {
  if (!scheduleData) return;

  const { view, param, extra } = parseHash();

  if (view === 'teachers') return renderTeachers();
  if (view === 'teacher' && param) return renderTeacherDetail(param);
  if (view === 'group' && param) return renderGroup(param, Number.isInteger(Number(extra)) ? Number(extra) : 0);

  renderHome();
}

function renderHome() {
  const groups = Array.from(groupIndex.values()).sort(compareGroups);
  const specialties = new Map();

  for (const group of groups) {
    if (!specialties.has(group.specialty)) specialties.set(group.specialty, []);
    specialties.get(group.specialty).push(group);
  }

  const names = Array.from(specialties.keys()).sort((a, b) => a.localeCompare(b, 'ru'));

  const specialtiesHtml = names.length
    ? `<div class="accordion">${names.map((specialty, i) => {
        const groupButtons = specialties.get(specialty).map((group) => `
          <button class="group-btn" data-nav="group/${encodeURIComponent(group.name)}/0">
            ${escapeHtml(group.name)}
          </button>
        `).join('');

        return `
          <div class="accordion-item" data-accordion-index="${i}">
            <button class="accordion-header" data-toggle="${i}">
              <span>${escapeHtml(specialty)}</span>
              <span class="chevron">▶</span>
            </button>
            <div class="accordion-body">${groupButtons}</div>
          </div>
        `;
      }).join('')}</div>`
    : '<div class="empty-state">Группы ещё не загружены.</div>';

  appEl.innerHTML = `
    <div class="hero">
      <h1>Расписание УМПК</h1>
      <span class="note">сайт не является официальным источником</span>
      <div class="hero-actions">
        <button class="btn btn-large" data-nav="teachers">Найти преподавателя</button>
      </div>
    </div>

    <div class="page-header">
      <h2>Мой курс и группа</h2>
    </div>

    ${specialtiesHtml}

    <div class="legal-footer">
      Этот сайт создан студентами и не является официальным ресурсом учебного заведения.
      Расписание собирается автоматически из открытого документа и может содержать
      неточности или расхождения с официальной версией.
    </div>
  `;

  appEl.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.accordion-item').classList.toggle('open');
    });
  });

  bindNavButtons();
}

function renderTeachers() {
  const names = Array.from(teacherIndex.keys()).sort((a, b) => a.localeCompare(b, 'ru'));

  appEl.innerHTML = `
    <div class="page-header">
      <button class="btn btn-ghost" data-nav="">← Назад</button>
      <h2>Преподаватели</h2>
    </div>

    <input class="search-input" id="teacherSearch" type="text"
           placeholder="Начните вводить фамилию…">

    <div class="teacher-list" id="teacherList">
      ${names.length
        ? names.map((name) => `
            <button class="teacher-row" data-nav="teacher/${encodeURIComponent(name)}">
              <span>${escapeHtml(name)}</span>
              <span class="count">${teacherIndex.get(name).length} занятий</span>
            </button>
          `).join('')
        : '<div class="empty-state">Преподаватели не найдены.</div>'
      }
    </div>
  `;

  bindNavButtons();

  document.getElementById('teacherSearch')?.addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();

    document.querySelectorAll('#teacherList .teacher-row').forEach((row) => {
      row.style.display = row.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
  });
}

function renderTeacherDetail(name) {
  const entries = teacherIndex.get(name) || [];

  const grouped = new Map();

  for (const entry of entries) {
    const key = `${entry.week}|${entry.day}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        week: entry.week,
        day: entry.day,
        lessons: [],
      });
    }

    grouped.get(key).lessons.push(entry);
  }

  const blocks = Array.from(grouped.values()).map((block) => `
    <div class="schedule-block">
      <h3>${escapeHtml(block.week)} — ${escapeHtml(block.day)}</h3>
      ${renderTeacherTable(block.lessons)}
    </div>
  `).join('');

  appEl.innerHTML = `
    <div class="page-header">
      <button class="btn btn-ghost" data-nav="teachers">← К списку</button>
      <h2>${escapeHtml(name)}</h2>
    </div>

    ${blocks || '<div class="empty-state">Занятия этого преподавателя не найдены.</div>'}
  `;

  bindNavButtons();
}

function renderTeacherTable(entries) {
  entries.sort((a, b) => a.number - b.number);

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>№</th>
            <th>Время</th>
            <th>Группа</th>
            <th>Предмет</th>
            <th>Ауд.</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((entry) => `
            <tr>
              <td>${escapeHtml(entry.number)}</td>
              <td>${escapeHtml(entry.time)}</td>
              <td>${escapeHtml(entry.group)}${entry.subgroup ? ` · подгр. ${escapeHtml(entry.subgroup)}` : ''}</td>
              <td>${escapeHtml(entry.subject || '—')}</td>
              <td>${escapeHtml(entry.room || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderGroup(groupName, weekIndex = 0) {
  const weeks = scheduleData.weeks || [];
  if (!weeks.length) {
    appEl.innerHTML = '<div class="empty-state">Нет данных о неделях.</div>';
    return;
  }

  if (weekIndex < 0 || weekIndex >= weeks.length) weekIndex = 0;

  const week = weeks[weekIndex];
  const group = groupIndex.get(groupName);

  const weekTabs = weeks.map((item, index) => `
    <button class="btn ${index === weekIndex ? '' : 'btn-ghost'}"
            data-week="${index}">
      ${escapeHtml(item.name)}
    </button>
  `).join('');

  const dayBlocks = (week.days || []).map((day) => {
    const rows = [];

    for (const lesson of day.lessons || []) {
      const entries = (lesson.entries || []).filter((entry) => entry.group === groupName);

      if (!entries.length) continue;

      for (const entry of entries) {
        rows.push(`
          <tr>
            <td>${escapeHtml(lesson.number)}</td>
            <td>${escapeHtml(lesson.time)}</td>
            <td>${escapeHtml(entry.subgroup ? `Подгр. ${entry.subgroup}` : '—')}</td>
            <td>${escapeHtml(entry.subject || '—')}</td>
            <td>${escapeHtml(entry.teacher || '—')}</td>
            <td>${escapeHtml(entry.room || '—')}</td>
          </tr>
        `);
      }
    }

    return `
      <div class="schedule-block">
        <h3>${escapeHtml(day.label)}</h3>
        ${rows.length ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Время</th>
                  <th>Подгруппа</th>
                  <th>Предмет</th>
                  <th>Преподаватель</th>
                  <th>Ауд.</th>
                </tr>
              </thead>
              <tbody>${rows.join('')}</tbody>
            </table>
          </div>
        ` : '<div class="empty-state">Занятий нет.</div>'}
      </div>
    `;
  }).join('');

  appEl.innerHTML = `
    <div class="page-header">
      <button class="btn btn-ghost" data-nav="">← Назад</button>
      <h2>${escapeHtml(groupName)}</h2>
    </div>

    <div class="hero-actions week-tabs">${weekTabs}</div>

    <input class="search-input" id="groupSearch" type="text"
           placeholder="Поиск по предмету или преподавателю…">

    <div id="groupSchedule">
      ${dayBlocks || '<div class="empty-state">Для этой группы нет занятий.</div>'}
    </div>
  `;

  bindNavButtons();

  appEl.querySelectorAll('[data-week]').forEach((button) => {
    button.addEventListener('click', () => {
      navigate(`#/group/${encodeURIComponent(groupName)}/${button.dataset.week}`);
    });
  });

  document.getElementById('groupSearch')?.addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();

    document.querySelectorAll('#groupSchedule tbody tr').forEach((row) => {
      row.classList.toggle('no-match', Boolean(query) && !row.textContent.toLowerCase().includes(query));
    });
  });
}

function compareGroups(a, b) {
  const courseA = Number(a.course) || 999;
  const courseB = Number(b.course) || 999;

  return courseA - courseB ||
    a.name.localeCompare(b.name, 'ru');
}

function bindNavButtons() {
  appEl.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      navigate('#' + button.getAttribute('data-nav'));
    });
  });
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value === null || value === undefined ? '' : String(value);
  return div.innerHTML;
}

async function init() {
  initTheme();

  try {
    await loadData();
    render();
  } catch (error) {
    appEl.innerHTML = `
      <div class="error-state">
        Не удалось загрузить расписание (${escapeHtml(error.message)}).
        <br>Если сайт только что запущен — дождитесь первого запуска GitHub Actions.
      </div>
    `;
  }
}

init();

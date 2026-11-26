import { ready, authorizedFetch, accessScope } from './auth.js';
await ready();
const projectStages = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', '丢单', '搁置', '其他'];
const projectWinLabel = value => value === '是' ? '已赢单' : '未赢单';
function projectStage(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^(已)?丢单$/.test(text)) return '丢单';
  if (text === '搁置') return text;
  const match = /^p([0-5])(?:$|[-\s])/i.exec(text);
  return match ? 'P' + match[1] : '其他';
}
function normalizeProject(record) {
  const stage = projectStage(record.stage);
  const previousStage = record.legacyStage || (stage !== record.stage ? record.stage : '');
  const won = ['是', '否'].includes(record.won) ? record.won : /^(已)?赢单$/.test(record.stage || '') ? '是' : '否';
  const base = { ...record, stage, won, archived: record.archived === true, winDate: record.winDate || '', reportDate: record.reportDate || '', projectUrl: record.projectUrl || '',
    legacyStage: previousStage, projectSchemaVersion: 2 };
  if (record.projectSchemaVersion === 2) return { ...base, followups: record.followups || [], todos: record.todos || [] };
  const followups = [...(record.followups || [])], todos = [...(record.todos || [])];
  const append = (items, entry) => {
    if (!entry.text || items.some(item => item.text === entry.text && (item.date || '') === (entry.date || ''))) return;
    items.push(entry);
  };
  const source = record.sources?.[0];
  if (previousStage) append(followups, { text: '原项目阶段：' + previousStage, date: '', kind: '历史阶段', ...(source ? { source } : {}) });
  if (record.progress) append(followups, { text: record.progress, date: record.date || '', kind: record.dateKind || '历史进展', ...(source ? { source } : {}) });
  for (const entry of [...(record.notionNotes || []), ...(record.notionRisks || [])]) append(followups, { ...entry, date: entry.date || '', kind: entry.kind || '' });
  if (record.next) append(todos, { text: record.next, date: record.followDate || record.suggestedDate || '', done: false });
  for (const entry of record.notionActions || []) append(todos, { text: entry.text, date: record.followDate || '', done: false });
  const legacy = [
    ['记录日期', record.date], ['日期说明', record.dateKind], ['部署日期', record.deploymentDate],
    ['原核实情况', record.check], ['原中腰表阶段', record.sheetStage], ['原来源备注', record.reference],
    ['原待补信息', (record.gaps || []).join('；')], ['原同名核实提示', record.sameName ? '有同名项目记录待核' : ''],
  ].filter(([, value]) => value).map(([label, value]) => label + '：' + value).join('\n');
  if (legacy) append(followups, { text: legacy, date: '', kind: '历史资料' });
  for (const origin of record.sources || []) append(followups, { text: origin.label || origin.url, date: '', kind: '历史资料来源', source: { ...origin } });
  return { ...base, followups, todos };
}
const projectIsClosed = record => record.won === '是' || record.stage === '丢单' || (record.stage === '其他' && /^(丢单|已丢单|终止|取消|已结束|已部署)$/.test(record.legacyStage || ''));

const consultationStages = ['待澄清需求', '方案准备中', '已提供方案', '跟进中', '暂缓', '不再推进', '已转项目'];
function consultationProjectDraft(row) {
  const entries = [
    ['客户 / 终端用户', row.customer], ['联系人', row.contact], ['咨询需求', row.need], ['已提供方案', row.proposal],
  ].filter(([, text]) => text).map(([kind, text]) => ({ text, kind, date: row.consultedDate || '',
    ...(row.referenceUrl ? { source: { label: '方案咨询资料', url: row.referenceUrl } } : {}) }));
  return {
    name: row.name, siId: row.siId || '', si: row.si || row.customer || '', sales: row.sales || '',
    sku: row.sku || '', units: row.units || '', priority: Boolean(row.priority), stage: 'P0',
    summary: [row.customer, row.need, row.proposal].filter(Boolean).join('\n\n').slice(0, 8000),
    followups: [...(row.followups || []).slice(-240), ...entries],
    todos: (row.todos || []).map(item => ({ ...item })), extra: (row.extra || []).map(item => ({ ...item })),
  };
}

const fields = {
  consultation: [
    ['咨询资料', [
      ['name', '方案 / 咨询名称', 'required'], ['siId', '关联 SI', 'relation'], ['si', '客户或 SI 名称'],
      ['customer', '客户 / 终端用户'], ['contact', '联系人'], ['sales', '销售'],
      ['consultedDate', '咨询日期', 'date'], ['stage', '咨询状态', 'choice', consultationStages],
      ['followDate', '下次跟进', 'date'], ['priority', '是否重点', 'boolean'], ['extra', '自定义字段', 'extra'],
    ]],
    ['需求与方案', [
      ['need', '客户需求', 'long'], ['proposal', '已提供方案与建议', 'long'],
      ['sku', '方案产品 / 机型'], ['units', '预计规模'], ['referenceUrl', '方案 / 沟通链接', 'url'],
    ]],
    ['进展与安排', [
      ['followups', '跟进记录', 'entries'], ['todos', '待办', 'todos'],
    ]],
  ],
  si: [
    ['客户资料', [
      ['name', 'SI 名称', 'required'], ['aliases', '别名', 'lines'], ['sales', '销售'],
      ['type', 'SI 类型'], ['tier', '客户规模', 'scale'],
      ['focus', '是否重点', 'boolean'], ['stage', '合作阶段'], ['city', '城市'],
      ['distributor', '分销商'], ['segment', '客户分组'], ['posClass', 'POS 分类'],
      ['meeting', '例会情况'], ['contact', '建联情况', 'long'],
    ]],
    ['跟进记录', [
      ['updates', '最近进展', 'entries'], ['next', '下一步', 'entries'],
      ['risks', '风险', 'entries'], ['notionNotes', '会议纪要与客户档案', 'entries'],
    ]],
    ['机会与资料', [
      ['products', '产品机会与导入', 'entries'], ['services', '服务机会与导入', 'entries'],
      ['gaps', '待补信息', 'lines'], ['sources', '来源链接', 'links'], ['extra', '自定义字段', 'extra'],
    ]],
  ],
  project: [
    ['项目资料', [
      ['name', '项目名称', 'required'], ['siId', '关联 SI', 'relation'], ['si', '客户或 SI 名称'],
      ['sales', '销售'], ['reportDate', '报备时间', 'date'], ['stage', '项目阶段', 'choice', projectStages], ['technical', '技术状态'],
      ['sku', '项目产品 / 机型'], ['units', '项目规模'], ['priority', '是否重点项目', 'boolean'],
      ['summary', '项目摘要', 'long'], ['projectUrl', '项目链接', 'url'], ['extra', '自定义字段', 'extra'],
    ]],
    ['借测', [
      ['loan', '是否借测', 'choice', ['是', '否']], ['loanDate', '借测开始日期', 'date'],
      ['loanReturn', '预计归还日期', 'date'], ['loanProduct', '借测产品'],
    ]],
    ['赢单', [
      ['won', '是否赢单', 'choice', ['是', '否']], ['winDate', '赢单时间', 'date'],
    ]],
    ['进展与安排', [
      ['followups', '跟进记录', 'entries'], ['todos', '待办', 'todos'],
    ]],
  ],
};
const allFields = kind => fields[kind].flatMap(([, group]) => group);

const kpiPeriod = { label: '2026 Q4', start: '2026-10-01', end: '2026-12-31' };
const kpiDefinitions = [];
const kpiNumber = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value);
const kpiPercent = (value, target) => target > 0 ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value / target * 100) : '0';
const kpiToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const kpiInPeriod = date => Boolean(date && date >= kpiPeriod.start && date <= kpiPeriod.end && date <= kpiToday());
const kpiIncludes = (goal, id) => goal?.children ? goal.children.includes(id) : goal?.id === id;

function kpiProjectEvidence(entry, project) {
  const linked = entry.entityKind === 'project' ? project : null;
  return {
    ...entry,
    date: linked?.winDate || (entry.dateFromProject ? '' : entry.date || ''),
    sourceUrl: linked?.projectUrl || (entry.sourceFromProject ? '' : entry.sourceUrl || ''),
    dateFromProject: Boolean(linked?.winDate),
    sourceFromProject: Boolean(linked?.projectUrl),
  };
}

function summarizeKpis(definitions, contributions, boardData) {
  const byId = new Map(definitions.map(goal => [goal.id, goal]));
  const entities = {
    project: new Map(boardData.projects.map(row => [row.id, row])),
    si: new Map(boardData.clients.map(row => [row.id, row])),
  };
  const entries = contributions.filter(entry => byId.has(entry.kpiId)).map(entry => {
    const goal = byId.get(entry.kpiId);
    const row = entities[entry.entityKind]?.get(entry.entityId);
    const recordedEvidence = entry.recordedEvidence || {
      date: entry.date || '', sourceUrl: entry.sourceUrl || '',
      dateFromProject: Boolean(entry.dateFromProject), sourceFromProject: Boolean(entry.sourceFromProject),
    };
    entry = kpiProjectEvidence({ ...entry, ...recordedEvidence }, row);
    const active = entry.entityKind === 'none' || Boolean(row);
    const classificationRequired = Boolean(goal.children);
    const recordedType = entry.aggregation || (entry.kpiId === 'service_revenue' ? 'amount' : entry.entityKind);
    const typeMismatch = recordedType !== goal.entity;
    return {
      ...entry, recordedEvidence, active, classificationRequired, typeMismatch, entityLabel: row?.name || entry.label,
      siName: entry.entityKind === 'project' ? row?.si || '' : '',
      counted: entry.status === 'confirmed' && active && kpiInPeriod(entry.date) && !classificationRequired && !typeMismatch,
    };
  });
  const goals = definitions.map(definition => {
    const records = entries.filter(entry => entry.kpiId === definition.id);
    const confirmed = records.filter(entry => entry.counted);
    const amount = definition.entity === 'amount'
      ? confirmed.reduce((sum, entry) => sum + Math.round(entry.amount * 1e6), 0) / 1e6
      : new Set(confirmed.map(entry => entry.entityKind + '/' + entry.entityId)).size;
    return {
      ...definition, completed: amount,
      pending: records.filter(entry => entry.status === 'pending' && entry.active && !entry.classificationRequired && !entry.typeMismatch).length,
      invalid: records.filter(entry => !entry.active || entry.classificationRequired || entry.typeMismatch ||
        (entry.status === 'confirmed' && !entry.counted)).length,
    };
  });
  const summaries = new Map(goals.map(goal => [goal.id, goal]));
  for (const goal of goals.filter(goal => goal.children)) {
    const children = goal.children.map(id => summaries.get(id)).filter(Boolean);
    goal.target = children.reduce((sum, child) => sum + child.target, 0);
    goal.completed = children.reduce((sum, child) => sum + child.completed, 0);
    goal.pending = children.reduce((sum, child) => sum + child.pending, 0);
    goal.invalid += children.reduce((sum, child) => sum + child.invalid, 0);
  }
  return { period: kpiPeriod, goals, contributions: entries };
}

function rebuildBoard(data, removedSi = new Map()) {
  const clients = new Map(data.clients.map(row => [row.id, { ...row, projects: [], archivedProjects: [], consultations: [] }]));
  const projects = data.projects.map(row => {
    const linked = clients.get(row.siId);
    const project = { ...row, siId: linked?.id || '', si: linked?.name || removedSi.get(row.siId) || row.si || '' };
    if (linked) (project.archived ? linked.archivedProjects : linked.projects).push(project);
    return project;
  });
  const consultations = (data.consultations || []).map(row => {
    const linked = clients.get(row.siId);
    const consultation = { ...row, siId: linked?.id || '', si: linked?.name || removedSi.get(row.siId) || row.si || '' };
    linked?.consultations.push(consultation);
    return consultation;
  });
  const result = { ...data, clients: [...clients.values()], projects, consultations };
  if (data.kpi) result.kpi = summarizeKpis(data.kpi.goals, data.kpi.contributions, result);
  return result;
}

function applyBoardChange(data, change) {
  const collection = change.type === 'record' ? ({ si: 'clients', project: 'projects', consultation: 'consultations' })[change.kind] :
    change.type === 'indicator' ? 'goals' : change.type === 'contribution' ? 'contributions' : '';
  if (!collection || !change.id || !Number.isSafeInteger(change.revision)) throw new Error('保存结果不完整。');
  const rows = change.type === 'record' ? data[collection] : data.kpi[collection];
  const key = change.type + '/' + (change.kind || '') + '/' + change.id;
  const known = Math.max(data.changeVersions?.[key] ?? -1, rows.find(row => row.id === change.id)?.revision ?? -1);
  if (known >= change.revision) return data;
  const next = change.deleted ? rows.filter(row => row.id !== change.id) : rows.some(row => row.id === change.id)
    ? rows.map(row => row.id === change.id ? change.record : row) : [...rows, change.record];
  const changed = change.type === 'record' ? { ...data, [collection]: next } :
    { ...data, kpi: { ...data.kpi, [collection]: next } };
  changed.changeVersions = { ...data.changeVersions, [key]: change.revision };
  const removed = change.type === 'record' && change.kind === 'si' && change.deleted
    ? new Map([[change.id, change.record.name]]) : new Map();
  return rebuildBoard(changed, removed);
}

const filterOperators = {
  contains: '包含', notContains: '不包含', eq: '等于', ne: '不等于',
  starts: '开头是', ends: '结尾是', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于',
  before: '早于', onBefore: '早于或等于', after: '晚于', onAfter: '晚于或等于',
  empty: '为空', notEmpty: '不为空',
};
const filterFold = value => String(value ?? '').normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase().trim();
function filterAtoms(value) {
  if (Array.isArray(value)) return value.flatMap(filterAtoms);
  if (value && typeof value === 'object') return ['text', 'label', 'value', 'date', 'kind', 'url'].flatMap(key => filterAtoms(value[key]));
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return [];
  return [typeof value === 'boolean' ? (value ? '是' : '否') : String(value).trim()];
}
function filterNumber(value) {
  const text = String(value ?? '').trim();
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*(?:V|台|间|个|人|%|万人民币)?$/i.test(text) ? Number.parseFloat(text) : NaN;
}
const filterDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function filterAllowed(type) {
  if (type === 'boolean') return ['eq', 'ne', 'empty', 'notEmpty'];
  if (type === 'date') return ['eq', 'ne', 'before', 'onBefore', 'after', 'onAfter', 'empty', 'notEmpty'];
  if (type === 'number') return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty'];
  const basic = ['contains', 'notContains', 'eq', 'ne', 'starts', 'ends'];
  if (['scale', 'custom'].includes(type)) basic.push('gt', 'gte', 'lt', 'lte');
  if (type === 'custom') basic.push('before', 'onBefore', 'after', 'onAfter');
  return [...basic, 'empty', 'notEmpty'];
}
function filterRuleActive(rule, definition) {
  if (!definition || !filterAllowed(definition.type).includes(rule.op)) return false;
  if (['empty', 'notEmpty'].includes(rule.op)) return true;
  if (!String(rule.value ?? '').trim()) return false;
  if (['gt', 'gte', 'lt', 'lte'].includes(rule.op) || definition.type === 'number') return Number.isFinite(filterNumber(rule.value));
  if (['before', 'onBefore', 'after', 'onAfter'].includes(rule.op) || definition.type === 'date') return filterDate(rule.value);
  return definition.type !== 'boolean' || ['是', '否'].includes(rule.value);
}
function filterCompare(value, rule, type = 'text') {
  const atoms = filterAtoms(value);
  if (rule.op === 'empty') return atoms.length === 0;
  if (rule.op === 'notEmpty') return atoms.length > 0;
  const query = filterFold(rule.value);
  const equals = item => type === 'number' ? filterNumber(item) === filterNumber(rule.value) : filterFold(item) === query;
  if (rule.op === 'eq') return atoms.some(equals);
  if (rule.op === 'ne') return !atoms.some(equals);
  if (rule.op === 'notContains') return !atoms.some(item => filterFold(item).includes(query));
  return atoms.some(item => {
    const text = filterFold(item);
    if (rule.op === 'contains') return text.includes(query);
    if (rule.op === 'starts') return text.startsWith(query);
    if (rule.op === 'ends') return text.endsWith(query);
    if (['before', 'onBefore', 'after', 'onAfter'].includes(rule.op)) {
      if (!filterDate(item)) return false;
      return ({ before: item < rule.value, onBefore: item <= rule.value, after: item > rule.value, onAfter: item >= rule.value })[rule.op];
    }
    const left = filterNumber(item), right = filterNumber(rule.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    return ({ gt: left > right, gte: left >= right, lt: left < right, lte: left <= right })[rule.op] ?? false;
  });
}
function filterMatches(row, configuration, definitions) {
  const active = configuration.rules.map(rule => ({ rule, field: definitions.get(rule.field) }))
    .filter(({ rule, field }) => filterRuleActive(rule, field));
  if (!active.length) return true;
  const check = ({ rule, field }) => filterCompare(field.get(row), rule, field.type);
  return configuration.mode === 'any' ? active.some(check) : active.every(check);
}
function filterLoad(value) {
  try {
    const data = JSON.parse(value);
    if (!data || !Array.isArray(data.rules)) return { mode: 'all', rules: [] };
    return { mode: data.mode === 'any' ? 'any' : 'all', rules: data.rules.slice(0, 40)
      .filter(rule => rule && typeof rule.field === 'string' && Object.hasOwn(filterOperators, rule.op))
      .map(rule => ({ field: rule.field.slice(0, 300), op: rule.op, value: String(rule.value ?? '').slice(0, 8000) })) };
  } catch { return { mode: 'all', rules: [] }; }
}

const fieldFilters = new Map();
function boardFilterFields(kind, rows) {
  const definitions = fields[kind].flatMap(([group, items]) => items.filter(([key, , type]) => key !== 'siId' && type !== 'extra')
    .map(([key, label, type]) => ({ key, label, group, type: ['date', 'boolean', 'scale'].includes(type) ? type : key === 'units' ? 'scale' : 'text', get: row => row[key] })));
  for (const [group, items] of fields[kind]) {
    for (const [key, label, type] of items.filter(([, , type]) => ['entries', 'todos', 'links', 'lines'].includes(type))) {
      definitions.push({ key: 'count:' + key, label: label + '（条数）', group: '记录数量', type: 'number', get: row => row[key]?.length ?? 0 });
      if (['entries', 'todos'].includes(type)) definitions.push({ key: 'date:' + key, label: label + '（最近日期）', group: '记录日期', type: 'date',
        get: row => (row[key] || []).map(item => item.date).filter(Boolean).sort().at(-1) || '' });
    }
  }
  if (kind === 'si') definitions.push({ key: 'projectCount', label: '关联项目数', group: '关联信息', type: 'number', get: row => row.projects.length });
  if (['project', 'consultation'].includes(kind)) definitions.push(
    { key: 'pendingTodoCount', label: '未完成待办数', group: '待办状态', type: 'number', get: row => (row.todos || []).filter(item => !item.done).length },
    { key: 'doneTodoCount', label: '已完成待办数', group: '待办状态', type: 'number', get: row => (row.todos || []).filter(item => item.done).length },
  );
  if (kind === 'consultation') definitions.push({ key: 'converted', label: '已转项目', group: '转化信息', type: 'boolean', get: row => Boolean(row.projectId) });
  const labels = [...new Set(rows.flatMap(row => (row.extra || []).map(item => item.label)).filter(Boolean))].sort(sortCollator.compare);
  definitions.push(...labels.map(label => ({ key: 'extra:' + label, label, group: '自定义字段', type: 'custom',
    get: row => (row.extra || []).filter(item => item.label === label).map(item => item.value) })));
  return definitions;
}
function kpiFilterFields() {
  const defs = [
    ['name', '指标名称'], ['entity', '统计方式', 'text', goal => ({ si: 'SI 数量', project: '项目数量', amount: '数值相加' })[goal.entity] || goal.entity],
    ['unit', '单位', 'text', kpiUnit], ['target', '目标', 'number'], ['completed', '已完成', 'number'],
    ['percent', '完成率（%）', 'number', goal => goal.target > 0 ? goal.completed / goal.target * 100 : 0],
    ['status', '达标状态', 'text', goal => goal.completed >= goal.target ? '已达标' : '尚未达标'],
    ['pending', '待确认贡献数', 'number'], ['invalid', '待核实记录数', 'number'], ['rule', '统计口径'],
    ['contributionName', '贡献项目 / SI', 'text', goal => kpiEntries(goal.id).flatMap(entry => [entry.entityLabel, entry.siName])],
    ['contributionStatus', '贡献状态', 'text', goal => kpiEntries(goal.id).map(kpiStatus)],
    ['contributionDate', '最近贡献日期', 'date', goal => kpiEntries(goal.id).map(entry => entry.date).filter(Boolean).sort().at(-1) || ''],
    ['contributionNote', '达成依据', 'text', goal => kpiEntries(goal.id).map(entry => entry.note)],
  ];
  return defs.map(([key, label, type = 'text', get]) => ({ key, label, type, group: 'KPI 字段', get: get || (goal => goal[key]) }));
}
function createFieldFilter(kind, label, getRows, getFields, onChange) {
  const root = element('filter-' + kind), storageKey = 'france-si-field-filters-v1:' + kind;
  let configuration = { mode: 'all', rules: [] }, saveAvailable = true, definitions = new Map(), ready = false;
  try { configuration = filterLoad(localStorage.getItem(storageKey)); } catch { saveAvailable = false; }
  const option = (value, title, selected) => '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(title) + '</option>';
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(configuration)); } catch { saveAvailable = false; }
    const message = root.querySelector('[data-filter-save]');
    if (message) message.textContent = saveAvailable ? '设置保存在此浏览器' : '当前浏览器无法保存筛选设置';
  }
  function valueInput(rule, field, index) {
    if (['empty', 'notEmpty'].includes(rule.op)) return '<span class="filter-no-value">无需填写值</span>';
    const aria = esc(label + '筛选值 ' + (index + 1));
    if (kind === 'project' && field?.key === 'won') return '<select data-filter-part="value" aria-label="' + aria + '">' +
      option('', '请选择', rule.value) + option('是', '已赢单', rule.value) + option('否', '未赢单', rule.value) + '</select>';
    if (field?.type === 'boolean') return '<select data-filter-part="value" aria-label="' + aria + '">' +
      option('', '请选择', rule.value) + option('是', '是', rule.value) + option('否', '否', rule.value) + '</select>';
    const date = field?.type === 'date' || ['before', 'onBefore', 'after', 'onAfter'].includes(rule.op);
    const numeric = field?.type === 'number' || ['gt', 'gte', 'lt', 'lte'].includes(rule.op);
    return '<input data-filter-part="value" aria-label="' + aria + '" type="' + (date ? 'date' : numeric ? 'number' : 'text') +
      '"' + (numeric ? ' step="any"' : ' autocomplete="off"') + ' value="' + esc(rule.value) +
      '" placeholder="' + (numeric ? '填写数值' : '输入关键词匹配词条') + '">';
  }
  function mountSearchInputs() {
    for (const select of root.querySelectorAll('[data-filter-part="field"]')) {
      for (const option of select.options) {
        if (option.parentElement.tagName === 'OPTGROUP') option.dataset.detail = option.parentElement.label;
      }
      mountRecordPicker(select, select.getAttribute('aria-label'), { placeholder: '输入关键词搜索字段', selectOnFocus: true });
      select.nextElementSibling.classList.add('filter-field-picker');
    }
    for (const input of root.querySelectorAll('input[data-filter-part="value"][type="text"]')) {
      const index = Number(input.closest('[data-filter-index]').dataset.filterIndex);
      const field = definitions.get(configuration.rules[index].field);
      mountRecordPicker(input, input.getAttribute('aria-label'), {
        freeText: true, limit: 100, placeholder: '输入关键词匹配词条',
        options: () => (field ? [...new Set(getRows().flatMap(row => filterAtoms(field.get(row))))] : [])
          .sort(sortCollator.compare).map(value => new Option(value, value)),
      });
      input.nextElementSibling.classList.add('filter-value-picker');
    }
  }
  function focusPart(index, part) {
    const control = root.querySelector('[data-filter-index="' + index + '"] [data-filter-part="' + part + '"]');
    (control?.hidden ? control.nextElementSibling?.querySelector('input') : control)?.focus();
  }
  function render() {
    definitions = new Map(getFields().map(field => [field.key, field]));
    const groups = new Map();
    for (const field of definitions.values()) { if (!groups.has(field.group)) groups.set(field.group, []); groups.get(field.group).push(field); }
    root.innerHTML = '<div class="field-filter-bar"><strong>筛选</strong><button type="button" class="outline" data-filter-add' +
      (!ready || configuration.rules.length >= 40 ? ' disabled' : '') + '>＋ 添加条件</button>' +
      (configuration.rules.length > 1 ? '<label class="filter-mode"><span>条件关系</span><select data-filter-mode aria-label="' + esc(label) + '筛选条件关系">' +
        option('all', '同时满足全部条件', configuration.mode) + option('any', '满足任一条件', configuration.mode) + '</select></label>' : '') +
      (configuration.rules.length ? '<button type="button" class="quiet" data-filter-clear>清空条件</button>' : '') +
      '<span class="filter-save" data-filter-save>' + (saveAvailable ? '设置保存在此浏览器' : '当前浏览器无法保存筛选设置') + '</span></div>' +
      (configuration.rules.length ? '<div class="field-filter-rules">' + configuration.rules.map((rule, index) => {
        const field = definitions.get(rule.field), operators = field ? filterAllowed(field.type) : [rule.op];
        return '<div class="field-filter-rule" data-filter-index="' + index + '"><select data-filter-part="field" aria-label="' + esc(label + '筛选字段 ' + (index + 1)) + '">' +
          (!field ? option(rule.field, '字段已不存在（此条件未应用）', rule.field) : '') +
          [...groups].map(([group, options]) => '<optgroup label="' + esc(group) + '">' + options.map(item => option(item.key, item.label, rule.field)).join('') + '</optgroup>').join('') +
          '</select><select data-filter-part="op" aria-label="' + esc(label + '筛选条件 ' + (index + 1)) + '">' + operators.map(op => option(op, filterOperators[op], rule.op)).join('') +
          '</select>' + valueInput(rule, field, index) + '<button type="button" class="icon-button" data-filter-remove aria-label="' + esc('删除' + label + '筛选条件 ' + (index + 1)) + '">×</button></div>';
      }).join('') + '</div>' : '');
    mountSearchInputs();
  }
  function changed(redraw = true) { save(); if (redraw) render(); onChange(); }
  const controller = {
    matches: row => filterMatches(row, configuration, definitions),
    refresh() { ready = true; render(); },
    clear() { configuration = { mode: 'all', rules: [] }; changed(); },
  };
  root.addEventListener('click', event => {
    if (event.target.closest('[data-filter-add]')) {
      const field = definitions.get(kind === 'si' ? 'sales' : kind === 'kpi' ? 'status' : 'stage') || definitions.values().next().value;
      if (!field || configuration.rules.length >= 40) return;
      configuration.rules.push({ field: field.key, op: ['boolean', 'date', 'number'].includes(field.type) ? 'eq' : 'contains', value: '' });
      changed(); focusPart(configuration.rules.length - 1, 'field');
    }
    if (event.target.closest('[data-filter-clear]')) controller.clear();
    if (event.target.closest('[data-filter-remove]')) {
      const index = Number(event.target.closest('[data-filter-index]').dataset.filterIndex);
      configuration.rules.splice(index, 1); changed(); root.querySelector('[data-filter-add]').focus();
    }
  });
  root.addEventListener('change', event => {
    if (event.target.matches('[data-filter-mode]')) { configuration.mode = event.target.value; changed(false); return; }
    const part = event.target.dataset.filterPart;
    if (!part || part === 'value' && event.target.tagName === 'INPUT') return;
    const index = Number(event.target.closest('[data-filter-index]').dataset.filterIndex), rule = configuration.rules[index];
    rule[part] = event.target.value;
    if (part === 'field') {
      const field = definitions.get(rule.field);
      if (!field) { rule.op = 'contains'; rule.value = ''; changed(false); return; }
      rule.op = ['boolean', 'date', 'number'].includes(field.type) ? 'eq' : 'contains'; rule.value = '';
    }
    if (part === 'op') rule.value = '';
    changed(part !== 'value');
    if (part === 'field' || part === 'op') focusPart(index, part);
  });
  root.addEventListener('input', event => {
    if (event.target.dataset.filterPart !== 'value' || event.target.tagName !== 'INPUT') return;
    const index = Number(event.target.closest('[data-filter-index]').dataset.filterIndex);
    configuration.rules[index].value = event.target.value; changed(false);
  });
  render(); fieldFilters.set(kind, controller); return controller;
}

const icons = {
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3m-4 4v2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z M3 12l9 5 9-5M3 16l9 5 9-5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m16 0v-2a4 4 0 0 0-3-3.9M15 3.4a4 4 0 0 1 0 7.2"/><circle cx="10" cy="7" r="4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 21V4m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8m-8 4h6"/>',
  arrow: '<path d="M5 12h13m-6-5 5 5-5 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  box: '<rect x="4" y="5" width="16" height="12" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  service: '<path d="M12 21s7-3 7-9V6l-7-3-7 3v6c0 6 7 9 7 9Z"/><path d="m9 12 2 2 4-4"/>',
};
const element = id => document.getElementById(id);
const details = element('details');
const pageSize = 14;
const state = { ready: false, tab: 'si', active: null, trigger: null, data: null, detailHistory: [], dataVersion: 0, loadSerial: 0, pendingWrites: 0 };
const boards = {
  si: {
    prefix: '', rows: [], page: 1, searchId: 'search', title: '客户列表',
    sortKey: '', sortDirection: 'ascending', sortFields: new Map(),
    columns: [['name', 'SI 客户'], ['tier', '客户规模'], ['stage', '合作阶段'], ['sales', '销售'], ['updates', '最近进展']],
  },
  project: {
    prefix: 'project-', rows: [], page: 1, searchId: 'project-search', title: '项目列表', archived: false,
    sortKey: '', sortDirection: 'ascending', sortFields: new Map(),
    columns: [['name', '项目'], ['si', 'SI / 销售'], ['stage', '项目阶段'], ['loan', '借测'],
      ['won', '是否赢单'], ['units', '项目规模'], ['todos', '待办']],
  },
  consultation: {
    prefix: 'consultation-', rows: [], page: 1, searchId: 'consultation-search', title: '方案咨询',
    sortKey: '', sortDirection: 'ascending', sortFields: new Map(),
    columns: [['name', '方案 / 客户'], ['si', 'SI / 销售'], ['stage', '咨询状态'], ['proposal', '需求与方案'], ['followDate', '跟进与待办'], ['projectId', '转化项目']],
  },
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, char => entities[char]);
const fold = text => text.normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase();
const pill = (label, type = '') => '<span class="pill ' + type + '">' + esc(label) + '</span>';
const unknown = (label = '待补') => '<span class="missing">' + esc(label) + '</span>';
const note = value => value ? '<span class="minor">' + esc(value) + '</span>' : '';
const stagePill = value => value ? pill(value, 'stage') : unknown();
const action = (title, css, attributes) => '<button type="button" class="' + css + '" ' + attributes + '>' + title + '</button>';
const recordKey = (kind, id) => 'data-open="' + kind + '" data-id="' + esc(id) + '"';
const openLink = (kind, row) => action(esc(row.name), 'name-link', recordKey(kind, row.id));
const editLink = (kind, row) => action('编辑', 'quiet row-open', 'data-edit="' + kind + '" data-id="' + esc(row.id) + '" aria-label="编辑 ' + esc(row.name) + '"');
const archiveLink = row => action(row.archived ? '取消归档' : '归档', 'quiet archive-action',
  'data-archive-project="' + esc(row.id) + '" data-inline-project="' + esc(row.id) + '" aria-label="' + esc((row.archived ? '取消归档 ' : '归档 ') + row.name) + '"');
const closed = projectIsClosed;
const conflict = project => Boolean(project.sameName || project.sheetStage || /冲突|重复|待核/.test(project.check));
const updates = row => (row.updates || []).filter(item => item.text).sort((a, b) => b.date.localeCompare(a.date));
const projectPreview = row => (row.todos || []).filter(item => !item.done).map(item => item.text).join('；') || row.followups?.at(-1)?.text || '';

function customerCells(row) {
  const last = updates(row)[0];
  return [
    openLink('si', row) + note([row.type, row.city].filter(Boolean).join(' · ')) +
      (row.focus ? '<span class="pills minor">' + pill('重点', 'focus') + '</span>' : ''),
    row.tier ? pill(row.tier) : unknown(), stagePill(row.stage), esc(row.sales) || unknown(),
    '<span class="progress-cell">' + (last ? esc(last.text) : unknown('近期进展待补')) + '</span>' +
      note(last?.date || (last ? '日期待补' : '')),
    editLink('si', row),
  ];
}

function projectCells(row) {
  const loanDetails = row.loan === '是' ? [row.loanDate, row.loanProduct].filter(Boolean).join(' · ') : '';
  return [
    openLink('project', row) + note(row.sku) + note(row.reportDate ? '报备 ' + row.reportDate : '') +
      (row.projectUrl ? '<span class="minor">' + sourceLink({ label: '项目链接', url: row.projectUrl }) + '</span>' : ''),
    (esc(row.si) || unknown()) + note(row.sales), projectStageSelect(row) + note(row.technical),
    (row.loan ? pill(row.loan, row.loan === '是' ? 'focus' : '') : unknown('未确认')) + note(loanDetails),
    pill(projectWinLabel(row.won), row.won === '是' ? 'focus' : '') + note(row.won === '是' ? row.winDate || '赢单时间待补' : ''),
    '<span class="mobile-scale-label" aria-hidden="true">项目规模</span>' + (esc(row.units) || unknown()),
    projectTodoList(row) + (row.priority ? '<span class="pills minor">' + pill('重点', 'focus') + '</span>' : ''),
    '<div class="project-row-actions">' + editLink('project', row) + archiveLink(row) + '</div>',
  ];
}

function projectStageSelect(row) {
  return '<select class="project-stage-select" data-inline-project="' + esc(row.id) + '" data-project-stage aria-label="' + esc(row.name + '的项目阶段') + '">' +
    [['', '未填写'], ...projectStages.map(value => [value, value])].map(([value, label]) => '<option value="' + value + '"' + (row.stage === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select>';
}

function projectTodoList(row, kind = 'project') {
  if (!row.todos?.length) return '<span class="missing">暂无待办</span>';
  return '<ul class="project-todos">' + row.todos.map((todo, index) => '<li class="' + (todo.done ? 'todo-done' : '') + '"><label><input type="checkbox"' +
    (todo.done ? ' checked' : '') + ' data-inline-' + kind + '="' + esc(row.id) + '" data-' + kind + '-todo="' + index + '" aria-label="' + esc(row.name + '：' + todo.text) + '">' +
    '<span class="multiline">' + esc(todo.text) + '</span></label>' +
    (todo.date ? '<span class="todo-date' + (!todo.done && todo.date < kpiToday() ? ' todo-overdue' : '') + '">截止 ' + esc(todo.date) + '</span>' : '') + '</li>').join('') + '</ul>';
}

const convertLink = row => row.projectId ? (findRecord('project', row.projectId)
  ? openLink('project', findRecord('project', row.projectId)) : unknown('原项目已删除'))
  : action('转为项目', 'outline', 'data-convert-consultation="' + esc(row.id) + '" aria-label="' + esc('转为项目 ' + row.name) + '"');
function consultationCells(row) {
  const stage = '<select class="consultation-stage-select" data-inline-consultation="' + esc(row.id) + '" data-consultation-stage aria-label="' +
    esc(row.name + '的咨询状态') + '"' + (row.projectId ? ' disabled' : '') + '>' + consultationStages.filter(value => value !== '已转项目' || row.projectId)
      .map(value => '<option' + (row.stage === value ? ' selected' : '') + '>' + esc(value) + '</option>').join('') + '</select>';
  return [
    openLink('consultation', row) + note(row.customer) + note(row.consultedDate) + (row.priority ? '<span class="minor">' + pill('重点', 'focus') + '</span>' : ''),
    (esc(row.si) || unknown('未关联 SI')) + note(row.sales), stage,
    (row.need ? '<p class="consultation-preview"><strong>需求：</strong>' + esc(row.need) + '</p>' : '') +
      (row.proposal ? '<p class="consultation-preview"><strong>方案：</strong>' + esc(row.proposal) + '</p>' : unknown('方案待补')),
    (row.followDate ? '<span class="consultation-follow-date' + (row.followDate < kpiToday() && !['已转项目', '暂缓', '不再推进'].includes(row.stage) ? ' overdue' : '') + '">下次跟进 ' + esc(row.followDate) + '</span>' : '') + projectTodoList(row, 'consultation'),
    row.projectId ? convertLink(row) + note(row.convertedAt ? '转化 ' + row.convertedAt : '') : '<span class="missing">尚未转化</span>',
    '<div class="project-row-actions">' + editLink('consultation', row) + (!row.projectId ? convertLink(row) : '') + '</div>',
  ];
}
const consultationPending = new Set();
async function saveConsultationInline(control) {
  const row = findRecord('consultation', control.dataset.inlineConsultation);
  if (!row || consultationPending.has(row.id)) return;
  const isStage = control.hasAttribute('data-consultation-stage'), index = Number(control.dataset.consultationTodo);
  if (!isStage && !row.todos?.[index]) return;
  const record = isStage ? { ...row, stage: control.value } : { ...row, todos: row.todos.map((item, i) => i === index ? { ...item, done: control.checked } : item) };
  consultationPending.add(row.id);
  document.querySelectorAll('[data-inline-consultation="' + row.id + '"]').forEach(item => { item.disabled = true; });
  try {
    const saved = await mutate('consultation', row, 'PUT', record);
    await afterMutation(isStage ? '已保存咨询状态' : '已保存待办状态', saved);
  } catch (error) {
    if (isStage) control.value = row.stage; else control.checked = row.todos[index].done;
    flash(error.message);
  } finally {
    consultationPending.delete(row.id);
    document.querySelectorAll('[data-inline-consultation="' + row.id + '"]').forEach(item => {
      item.disabled = item.hasAttribute('data-consultation-stage') && Boolean(findRecord('consultation', row.id)?.projectId);
    });
  }
}

const projectInlinePending = new Set();
async function setProjectArchived(row, button) {
  if (!row || projectInlinePending.has(row.id)) return;
  const archived = !row.archived;
  projectInlinePending.add(row.id);
  document.querySelectorAll('[data-inline-project="' + row.id + '"]').forEach(control => { control.disabled = true; });
  try {
    setButtonBusy(button, true, archived ? '归档中…' : '恢复中…');
    const saved = await mutate('project', row, 'PATCH', { archived });
    await afterMutation(archived ? '已归档项目，可在顶部「归档项目」中查看' : '已取消归档，项目已恢复正常显示', saved);
  } catch (error) { flash(error.message); }
  finally {
    projectInlinePending.delete(row.id);
    document.querySelectorAll('[data-inline-project="' + row.id + '"]').forEach(control => { control.disabled = false; });
    setButtonBusy(button, false);
  }
}

async function saveProjectInline(control) {
  const id = control.dataset.inlineProject, row = findRecord('project', id);
  if (!row || projectInlinePending.has(id)) return;
  const isStage = control.hasAttribute('data-project-stage');
  const index = Number(control.dataset.projectTodo);
  if (!isStage && !row.todos?.[index]) return;
  const record = isStage ? { stage: control.value } : { todos: row.todos.map((item, position) => position === index ? { ...item, done: control.checked } : item) };
  projectInlinePending.add(id);
  document.querySelectorAll('[data-inline-project="' + id + '"]').forEach(element => { element.disabled = true; });
  try {
    const saved = await mutate('project', row, 'PATCH', record);
    await afterMutation(isStage ? '已保存项目阶段' : '已保存待办状态', saved);
  } catch (error) {
    if (isStage) control.value = row.stage;
    else control.checked = row.todos[index].done;
    flash(error.message);
  } finally {
    projectInlinePending.delete(id);
    document.querySelectorAll('[data-inline-project="' + id + '"]').forEach(element => { element.disabled = false; });
  }
}

const scaleOrder = value => value ? value === '头部' ? Number.MAX_SAFE_INTEGER : Number.parseFloat(value) : undefined;
const sortCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function sortOptions(kind) {
  const groups = fields[kind].map(([group, definitions]) => [
    group,
    definitions.filter(([key]) => key !== 'siId' && key !== 'extra').map(([key, label, type, choices]) => {
      if (type === 'scale') return { key, label, value: row => scaleOrder(row[key]) };
      if (key === 'updates') return { key, label: '最近进展日期', value: row => updates(row)[0]?.date };
      if (['lines', 'entries', 'todos', 'links'].includes(type)) {
        return { key, label: label + '（条数）', value: row => row[key]?.length ?? 0 };
      }
      return {
        key, label,
        value: choices ? row => {
          const order = choices.indexOf(row[key]);
          return order < 0 ? undefined : order;
        } : row => row[key],
      };
    }),
  ]);
  const derived = kind === 'si'
    ? { key: 'projectCount', label: '关联项目数', value: row => row.projects.length }
    : { key: 'projectPreview', label: '待办 / 最近跟进（文本）', value: projectPreview };
  groups.push(['列表', [derived]]);
  if (kind === 'consultation') groups.push(['转化信息', [{ key: 'projectId', label: '转化项目', value: row => findRecord('project', row.projectId)?.name || '' }]]);
  const labels = new Set(boards[kind].rows.flatMap(row => (row.extra || []).map(item => item.label)).filter(Boolean));
  if (labels.size) groups.push(['自定义字段', [...labels].sort(sortCollator.compare).map(label => ({
    key: 'extra:' + label, label, value: row => (row.extra || []).find(item => item.label === label)?.value,
  }))]);
  return groups;
}

function setupSortOptions(kind) {
  const info = boards[kind];
  const groups = sortOptions(kind);
  info.sortFields = new Map(groups.flatMap(([, options]) => options.map(option => [option.key, option])));
  if (!info.sortFields.has(info.sortKey)) info.sortKey = '';
  const select = element(info.prefix + 'sort-field');
  select.replaceChildren(new Option('默认顺序', ''), ...groups.map(([label, options]) => {
    const group = document.createElement('optgroup');
    group.label = label;
    group.append(...options.map(option => new Option(option.label, option.key)));
    return group;
  }));
  select.disabled = false;
}

function sortRows(rows, field, direction) {
  if (!field) return rows;
  const missing = value => value == null || value === '';
  const order = direction === 'ascending' ? 1 : -1;
  return rows.map(row => ({ row, value: field.value(row) })).sort((a, b) => {
    if (missing(a.value) || missing(b.value)) return Number(missing(a.value)) - Number(missing(b.value));
    const compare = typeof a.value === 'string' ? sortCollator.compare(a.value, b.value) : Number(a.value) - Number(b.value);
    return order * compare;
  }).map(item => item.row);
}

function setSort(kind, key, direction) {
  const info = boards[kind];
  info.sortKey = info.sortFields.has(key) ? key : '';
  info.sortDirection = direction;
  info.page = 1;
  renderBoard(kind);
}

function sortHeader(kind, [key, label]) {
  const info = boards[kind];
  const active = key === info.sortKey;
  const target = active && info.sortDirection === 'ascending' ? '降序' : '升序';
  const marker = active ? (info.sortDirection === 'ascending' ? '↑' : '↓') : '↕';
  const tooltip = '按' + info.sortFields.get(key).label + target;
  return '<th scope="col"' + (active ? ' aria-sort="' + info.sortDirection + '"' : '') + '>' +
    action(esc(label) + '<span aria-hidden="true">' + marker + '</span>', 'sort-heading',
      'data-sort-column="' + key + '" title="' + esc(tooltip) + '" aria-label="' + esc(tooltip) + '"') + '</th>';
}

function renderBoard(kind) {
  if (!state.ready) return;
  const info = boards[kind];
  const project = kind === 'project';
  const byId = id => element(info.prefix + id);
  const query = fold(element(info.searchId).value.trim()).split(/\s+/).filter(Boolean);
  const matching = info.rows.filter(row => (!project || Boolean(row.archived) === info.archived) && (fieldFilters.get(kind)?.matches(row) ?? true) &&
    query.every(term => row.searchText.includes(term)));
  byId('sort-field').value = info.sortKey;
  const direction = byId('sort-direction');
  direction.disabled = !info.sortKey;
  direction.textContent = info.sortDirection === 'ascending' ? '↑ 升序' : '↓ 降序';
  const ordered = sortRows(matching, info.sortFields.get(info.sortKey), info.sortDirection);
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize));
  info.page = Math.min(info.page, pages);
  const first = (info.page - 1) * pageSize;
  const shown = ordered.slice(first, first + pageSize);
  const unit = kind === 'si' ? ' 家' : ' 条';
  byId('list-title').textContent = project && info.archived ? '归档项目' : info.title;
  if (project) {
    const count = info.rows.filter(row => row.archived).length;
    const toggle = element('project-archive-toggle');
    toggle.disabled = false;
    toggle.textContent = '归档项目（' + count + '）';
    toggle.setAttribute('aria-pressed', String(info.archived));
    element('project-archive-description').textContent = info.archived ? '正在查看归档项目，再次点击返回未归档项目' : '默认显示未归档项目';
  }
  element(kind === 'si' ? 'count-results' : info.prefix + 'result-count').textContent = matching.length + unit;
  const columns = info.columns.map(column => sortHeader(kind, column)).join('');
  const cells = kind === 'consultation' ? consultationCells : project ? projectCells : customerCells;
  byId('list').innerHTML = shown.length
    ? '<table><thead><tr>' + columns + '<th scope="col">操作</th></tr></thead><tbody>' +
      shown.map(row => '<tr>' + cells(row).map(val => '<td>' + val + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
    : kind === 'consultation' && !info.rows.length
      ? '<div class="empty"><p>还没有方案咨询。记录客户需求或已提供的方案，安排后续跟进。</p>' + action('记录第一条方案咨询', 'outline', 'data-add="consultation"') + '</div>'
      : '<div class="empty"><p>没有符合当前筛选的记录。</p>' + action('清除筛选', 'outline', 'data-reset="' + kind + '"') + '</div>';
  byId('pagination').hidden = !matching.length;
  byId('pages').textContent = '显示 ' + (first + 1) + '–' + (first + shown.length) + ' / ' + matching.length + unit;
  byId('previous').disabled = info.page === 1;
  element(kind === 'si' ? 'next-page' : info.prefix + 'next').disabled = info.page >= pages;
}

function refreshFilters(kind, reset = false) {
  const info = boards[kind];
  if (reset) {
    element(info.searchId).value = '';
    fieldFilters.get(kind)?.clear();
  }
  info.page = 1;
  renderBoard(kind);
}

async function request(path, args) {
  const writing = args?.method && args.method !== 'GET';
  if (writing) { state.pendingWrites++; state.dataVersion++; }
  try {
    const response = await authorizedFetch(path, args);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (writing && response.status === 409) scheduleBoardSync();
      throw new Error(data.error ?? '无法访问看板，请重试。');
    }
    const data = await response.json();
    if (writing) {
      state.dataVersion++;
      if ((data.change || data.changes) && state.data) {
        try { applyBoardData((data.changes || [data.change]).reduce(applyBoardChange, state.data)); data.applied = true; }
        catch { data.applied = false; }
      }
    }
    return data;
  } finally { if (writing) state.pendingWrites--; }
}

let boardSyncTimer;
function scheduleBoardSync() {
  clearTimeout(boardSyncTimer);
  boardSyncTimer = setTimeout(async () => {
    if (state.pendingWrites) { scheduleBoardSync(); return; }
    try { await loadBoard(); } catch { /* Confirmed local results remain usable during a transient read failure. */ }
  }, 1500);
}

function setButtonBusy(button, busy, label = '保存中…') {
  if (busy) {
    button.dataset.idleLabel ||= button.textContent;
    button.textContent = label;
  } else if (button.dataset.idleLabel) {
    button.textContent = button.dataset.idleLabel;
    delete button.dataset.idleLabel;
  }
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

async function loadBoard() {
  const serial = ++state.loadSerial, version = state.dataVersion;
  const data = await request('/api/board');
  if (state.pendingWrites || serial !== state.loadSerial || version !== state.dataVersion) return false;
  data.changeVersions = state.data?.changeVersions || {};
  applyBoardData(data);
  return true;
}

function applyBoardData(data) {
  state.data = data;
  const clients = data.clients.map(row => ({ ...row, searchText: fold([
    row.name, ...row.aliases, row.city, row.sales, row.type, row.tier, row.distributor,
    ...row.products.map(item => item.text), ...row.services.map(item => item.text),
    ...row.projects.flatMap(project => [project.name, project.sku]),
    ...updates(row).map(item => item.text), ...(row.extra || []).flatMap(item => [item.label, item.value]),
  ].join(' ')) }));
  const projects = data.projects.map(row => ({ ...row, searchText: fold([
    row.name, row.si, row.sales, row.sku, row.loanProduct, row.summary, row.reportDate, row.winDate, row.projectUrl,
    ...(row.followups || []).map(item => item.text), ...(row.todos || []).map(item => item.text), ...(row.extra || []).flatMap(item => [item.label, item.value]),
  ].join(' ')) }));
  clients.sort((a, b) => Number(b.focus) - Number(a.focus) || (updates(b)[0]?.date || '').localeCompare(updates(a)[0]?.date || '')
    || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  boards.si.rows = clients;
  boards.project.rows = projects;
  boards.consultation.rows = (data.consultations || []).map(row => ({ ...row, searchText: fold([
    row.name, row.customer, row.contact, row.si, row.sales, row.sku, row.units, row.need, row.proposal,
    ...(row.followups || []).map(item => item.text), ...(row.todos || []).map(item => item.text), ...(row.extra || []).flatMap(item => [item.label, item.value]),
  ].join(' ')) }));
  element('tab-si-count').textContent = clients.length;
  element('tab-project-count').textContent = projects.filter(row => !row.archived).length;
  element('tab-consultation-count').textContent = boards.consultation.rows.length;
  state.ready = true;
  for (const kind of Object.keys(boards)) {
    element('add-' + kind).disabled = false;
    setupSortOptions(kind);
    fieldFilters.get(kind).refresh();
    renderBoard(kind);
  }
  updateKpiData(data.kpi);
  upRenderGoals();
}

function loadError(error) {
  element('kpi-cards').innerHTML = '<div class="empty" role="alert"><p>' + esc(error.message) + '</p>' +
    action('重新加载', 'outline', 'data-retry') + '</div>';
  for (const kind of Object.keys(boards)) {
    element(boards[kind].prefix + 'list').innerHTML = '<div class="empty" role="alert"><p>' + esc(error.message) +
      '</p>' + action('重新加载', 'outline', 'data-retry') + '</div>';
  }
}

function showWorkspace(kind, push = false) {
  if(typeof accessScope!=='undefined'&&accessScope==='upsell')kind='upsell';
  state.tab = kind;
  if (kind === 'upsell' && !up.loaded) loadUpsell();
  const tabs = { upsell: ['upsell-board','tab-upsell'], si: ['si-board', 'tab-si'], project: ['project-board', 'tab-projects'], consultation: ['consultation-board', 'tab-consultations'], kpi: ['kpi-board', 'tab-kpi'] };
  const id = tabs[kind][0];
  if (push && location.hash !== '#' + id) history.pushState(null, '', '#' + id);
  for (const [name, [boardId, tabId]] of Object.entries(tabs)) {
    element(boardId).hidden = name !== kind;
    element(tabId).removeAttribute('aria-current');
  }
  element(tabs[kind][1]).setAttribute('aria-current', 'page');
}

function sourceLink(source) {
  const label = source?.label || source?.url || '';
  if (/^https?:\/\/[^\s/]+/i.test(source?.url || '')) {
    return '<a href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>';
  }
  return esc(label);
}

function listOf(items) {
  if (!items?.length) return '';
  return '<ul>' + items.map(item => {
    const parts = [esc(item.date), esc(item.kind), sourceLink(item.source)].filter(Boolean);
    return '<li><span class="multiline">' + esc(item.text) + '</span>' +
      (parts.length ? '<span class="entry-meta">' + parts.join(' · ') + '</span>' : '') + '</li>';
  }).join('') + '</ul>';
}
const section = (title, contents, controls = '') => '<section class="drawer-section"><div class="block-heading"><h3>' + esc(title) +
  '</h3>' + controls + '</div>' + contents + '</section>';
const editRecordLink = (kind, row, title = '编辑', group = '') =>
  action(title, 'outline', 'data-edit="' + kind + '" data-id="' + esc(row.id) + '" data-group="' + group + '" aria-label="' +
    esc(title + (group ? ' ' + (allFields(kind).find(([key]) => key === group)?.[1] || group) : '')) + '"');
const fact = (label, value) => '<dt>' + esc(label) + '</dt><dd class="multiline">' + esc(value) + '</dd>';
const recordLabel = kind => ({ si: 'SI', project: '项目', consultation: '方案咨询' })[kind];

function recordDetails(kind, row) {
  const si = kind === 'si';
  const associated = row.siId ? boards.si.rows.find(client => client.id === row.siId) : null;
  const relationship = si ? section('关联项目（' + row.projects.length + '）',
    row.projects.length ? '<div class="project-list">' + row.projects.map(project =>
      '<article class="project">' + openLink('project', project) + note([project.stage, project.sku, project.loan === '是' ? '借测' : ''].filter(Boolean).join(' · ')) + '</article>'
    ).join('') + '</div>' : '<p class="missing">暂无关联项目。</p>',
    action('＋ 添加项目', 'outline', 'data-add="project" data-si="' + esc(row.id) + '"')
  ) : associated ? section('关联 SI', openLink('si', associated)) : '';
  const archivedNames = si && row.archivedProjects?.length ? section('已归档项目（' + row.archivedProjects.length + '）',
    '<p class="archived-project-names">' + row.archivedProjects.map(project => esc(project.name)).join('、') + '</p>') : '';
  const consultationLinks = si ? section('方案咨询（' + (row.consultations?.length || 0) + '）',
    row.consultations?.length ? '<ul class="consultation-links">' + row.consultations.map(item => '<li>' + openLink('consultation', item) + ' ' + pill(item.stage) + '</li>').join('') + '</ul>' : '<p class="missing">暂无方案咨询。</p>',
    action('＋ 记录方案咨询', 'outline', 'data-add="consultation" data-si="' + esc(row.id) + '"')) : '';
  const conversion = kind === 'consultation' ? section('项目转化', convertLink(row) + note(row.convertedAt ? '转化日期 ' + row.convertedAt : '机会明确后，可带入现有资料创建项目。')) :
    kind === 'project' && row.sourceConsultationId ? section('来源方案咨询', findRecord('consultation', row.sourceConsultationId)
      ? openLink('consultation', findRecord('consultation', row.sourceConsultationId)) : '<p class="missing">原方案咨询已删除。</p>') : '';
  const renderFieldGroup = ([title, group]) => {
    const facts = [];
    const lists = [];
    for (const [key, label, type] of group) {
      const value = row[key];
      if (['name', 'siId', 'updates'].includes(key)) continue;
      const edit = editRecordLink(kind, row, value?.length ? '编辑' : '添加', key);
      if (type === 'todos') {
        lists.push(section(label, projectTodoList(row, kind), editRecordLink(kind, row, '管理待办', key)));
      } else if (type === 'url') {
        if (value) lists.push(section(label, sourceLink({ label: '打开' + label, url: value })));
      } else if (type === 'entries' || type === 'lines') {
        if (value?.length || si || kind === 'consultation') lists.push(section(label, value?.length ? listOf(type === 'lines' ? value.map(text => ({ text })) : value) : '<p class="missing">暂无记录。</p>', edit));
      } else if (type === 'links') {
        if (value?.length || si) lists.push(section(label, value?.length ? '<div class="source-list">' + value.map(sourceLink).join('') + '</div>' : '<p class="missing">暂无链接。</p>', edit));
      } else if (type === 'extra') {
        if (value?.length || si) lists.push(section(label, value?.length ? '<dl class="project-facts">' + value.map(item => fact(item.label, item.value)).join('') + '</dl>' : '<p class="missing">暂无自定义字段。</p>', edit));
      } else if (type === 'boolean') {
        facts.push(fact(label, value ? '是' : '否'));
      } else if (key === 'won') {
        facts.push(fact(label, projectWinLabel(value)));
      } else if (key === 'loan' || key === 'tier') {
        facts.push(fact(label, value || (key === 'loan' ? '未确认' : '未填写')));
      } else if (value) {
        facts.push(fact(label, value));
      }
    }
    return (facts.length ? section(title, '<dl class="project-facts">' + facts.join('') + '</dl>',
      editRecordLink(kind, row, '编辑', group[0][0])) : '') + lists.join('');
  };
  const recent = si ? section('最近进展',
    listOf(updates(row)) || '<p class="missing">暂无进展记录。</p>',
    editRecordLink(kind, row, '管理记录', 'updates')) : '';
  const scaleSource = si && row.potential26 ? section('客户规模来源',
    '<p>' + esc(row.potential26.field) + ' · ' + esc(row.potential26.value || '待补') + '</p>' +
    '<div class="entry-meta">' + sourceLink(row.potential26.source) + '</div>' +
    note(row.tierOrigin === 'manual' ? '当前使用手动填写的客户规模。' : '当前使用中腰表潜力。')) : '';
  const [profile, ...otherGroups] = fields[kind];
  return '<div class="drawer-heading"><h2 id="drawer-title">' + esc(row.name) + '</h2><div class="actions detail-actions">' +
    editRecordLink(kind, row, '编辑' + recordLabel(kind)) +
    (kind === 'project' ? archiveLink(row) : '') +
    action('删除' + recordLabel(kind), 'outline danger-text', 'data-delete-confirm="' + kind + '" data-id="' + esc(row.id) + '"') +
    '</div>' + (!si && row.archived ? '<p>' + pill('已归档') + '</p>' : '') + '</div>' + renderFieldGroup(profile) + scaleSource + recent + relationship + archivedNames + consultationLinks + conversion + kpiRecordSection(kind, row) + otherGroups.map(renderFieldGroup).join('');
}

function findRecord(kind, id) {
  return boards[kind]?.rows.find(row => row.id === id);
}

function openDetails(kind, row, trigger, options = {}) {
  if (!row) return;
  if (!details.open) {
    state.trigger = trigger;
    state.detailHistory = [];
  } else if (!options.back && state.active && (state.active.kind !== kind || state.active.id !== row.id) && details.contains(trigger)) {
    state.detailHistory.push({ ...state.active, scrollTop: details.scrollTop, focusKind: kind, focusId: row.id });
  }
  state.active = { kind, id: row.id };
  element('drawer-category').textContent = recordLabel(kind) + '详情';
  const back = element('details-back');
  const previous = state.detailHistory.at(-1);
  const previousRow = previous && findRecord(previous.kind, previous.id);
  back.hidden = !previousRow;
  back.innerHTML = previousRow ? icon('back') + '<span>' + esc('返回 ' + previousRow.name) + '</span>' : '';
  back.setAttribute('aria-label', previousRow ? '返回 ' + previousRow.name + ' 详情' : '返回上一条详情');
  const edit = element('details-edit');
  edit.dataset.edit = kind;
  edit.dataset.id = row.id;
  edit.setAttribute('aria-label', '编辑当前' + recordLabel(kind) + '资料');
  element('drawer-content').innerHTML = recordDetails(kind, row);
  if (!details.open) details.showModal();
  const focus = options.focusKind && [...details.querySelectorAll('[data-open]')].find(button =>
    button.dataset.open === options.focusKind && button.dataset.id === options.focusId);
  (focus || element(previousRow ? 'details-back' : 'details-close')).focus({ preventScroll: true });
  details.scrollTop = options.scrollTop ?? 0;
}

function backToDetails() {
  let previous;
  while ((previous = state.detailHistory.pop())) {
    const row = findRecord(previous.kind, previous.id);
    if (row) { openDetails(previous.kind, row, null, { ...previous, back: true }); return; }
  }
}

let noticeTimer;
function flash(message) {
  const notice = element('notice');
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 7000);
}

function initApp() {
  document.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
  for (const [kind, info] of Object.entries(boards)) {
    const project = kind === 'project';
    createFieldFilter(kind, recordLabel(kind), () => info.rows, () => boardFilterFields(kind, info.rows), () => refreshFilters(kind));
    element(info.searchId).addEventListener('input', () => refreshFilters(kind));
    element(kind === 'si' ? 'clear' : info.prefix + 'reset').addEventListener('click', () => refreshFilters(kind, true));
    const sortField = element(info.prefix + 'sort-field');
    const otherDirection = () => info.sortDirection === 'ascending' ? 'descending' : 'ascending';
    sortField.addEventListener('change', () => setSort(kind, sortField.value, 'ascending'));
    element(info.prefix + 'sort-direction').addEventListener('click', () => setSort(kind, info.sortKey, otherDirection()));
    const list = element(info.prefix + 'list');
    if (project) list.addEventListener('change', event => {
      const control = event.target.closest('[data-inline-project]');
      if (control) saveProjectInline(control);
    });
    if (kind === 'consultation') list.addEventListener('change', event => {
      const control = event.target.closest('[data-inline-consultation]');
      if (control) saveConsultationInline(control);
    });
    list.addEventListener('click', event => {
      const header = event.target.closest('[data-sort-column]');
      if (!header) return;
      const key = header.dataset.sortColumn;
      setSort(kind, key, key === info.sortKey ? otherDirection() : 'ascending');
      list.querySelector('[data-sort-column="' + key + '"]')?.focus({ preventScroll: true });
    });
    element(info.prefix + 'previous').addEventListener('click', () => { info.page--; renderBoard(kind); });
    element(kind === 'si' ? 'next-page' : info.prefix + 'next').addEventListener('click', () => { info.page++; renderBoard(kind); });
  }
  element('tab-upsell').addEventListener('click', event => { event.preventDefault(); showWorkspace('upsell', true); });
  element('tab-si').addEventListener('click', event => { event.preventDefault(); showWorkspace('si', true); });
  element('tab-projects').addEventListener('click', event => { event.preventDefault(); showWorkspace('project', true); });
  element('tab-kpi').addEventListener('click', event => { event.preventDefault(); showWorkspace('kpi', true); });
  element('tab-consultations').addEventListener('click', event => { event.preventDefault(); showWorkspace('consultation', true); });
  element('project-archive-toggle').addEventListener('click', () => {
    boards.project.archived = !boards.project.archived;
    refreshFilters('project');
  });
  const fromHash = () => showWorkspace(({ '#upsell-board': 'upsell', '#project-board': 'project', '#consultation-board': 'consultation', '#kpi-board': 'kpi' })[location.hash] || 'si');
  window.addEventListener('popstate', fromHash);
  window.addEventListener('hashchange', fromHash);
  window.addEventListener('focus', scheduleBoardSync);
  fromHash();

  element('details-close').addEventListener('click', () => details.close());
  element('details-back').addEventListener('click', backToDetails);
  details.addEventListener('close', () => {
    if (details.open) return;
    state.active = null;
    state.detailHistory = [];
    (state.trigger?.isConnected ? state.trigger : element(state.tab === 'upsell' ? 'up-search' : state.tab === 'kpi' ? 'kpi-search' : boards[state.tab].searchId)).focus({ preventScroll: true });
  });
  details.addEventListener('change', event => {
    const control = event.target.closest('[data-inline-project]');
    if (control) saveProjectInline(control);
    const consultation = event.target.closest('[data-inline-consultation]');
    if (consultation) saveConsultationInline(consultation);
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const { open, edit, add, reset, id, group, si, deleteConfirm, retry, archiveProject, convertConsultation } = button.dataset;
    if (open) openDetails(open, findRecord(open, id), button);
    if (edit) openEditor(edit, findRecord(edit, id), { group, trigger: button });
    if (add) openEditor(add, null, { si, trigger: button });
    if (deleteConfirm) askDelete(deleteConfirm, findRecord(deleteConfirm, id));
    if (archiveProject) setProjectArchived(findRecord('project', archiveProject), button);
    if (convertConsultation) openConsultationConversion(findRecord('consultation', convertConsultation), button);
    if (reset) refreshFilters(reset, true);
    if (retry !== undefined) loadBoard().catch(loadError);
  });
  initKpi();
  loadBoard().catch(loadError);
}

const recordPickers = new WeakMap();
let recordPickerId = 0;

function recordOptions(rows) {
  return rows.map(row => {
    const label = row.name + (row.si ? ' · ' + row.si : '');
    const option = new Option(label, row.id);
    option.dataset.detail = [
      row.sales ? '销售 ' + row.sales : '', row.city, row.stage, row.sku,
      row.units ? '规模 ' + row.units : '', row.date, row.scope,
    ].filter(Boolean).join(' · ');
    option.dataset.search = [row.name, row.si, row.sales, row.city, row.sku, ...(row.aliases || [])].filter(Boolean).join(' ');
    return option;
  });
}

function mountRecordPicker(select, label, settings = {}) {
  let picker = recordPickers.get(select);
  if (!picker) {
    picker = createRecordPicker(select, label, settings);
    recordPickers.set(select, picker);
  }
  picker.refresh();
}

function createRecordPicker(select, label, settings = {}) {
  const id = 'record-options-' + ++recordPickerId;
  const wrapper = document.createElement('div');
  wrapper.className = 'record-picker';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'record-picker-input';
  input.placeholder = settings.placeholder || '输入字母或名称搜索';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', label);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-expanded', 'false');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'record-picker-clear';
  clear.setAttribute('aria-label', '清除' + label);
  clear.textContent = '×';
  const list = document.createElement('div');
  list.id = id;
  list.className = 'record-picker-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', label + '匹配结果');
  list.hidden = true;
  const status = document.createElement('span');
  status.className = 'sr-only';
  status.setAttribute('aria-live', 'polite');
  wrapper.append(input, clear, list, status);
  select.hidden = true;
  select.insertAdjacentElement('afterend', wrapper);
  let options = [];
  let matches = [];
  let active = -1;
  let required = false;
  let composing = false;

  function validate() {
    const unselected = !settings.freeText && input.value.trim() && !select.value;
    input.setCustomValidity(unselected ? '请从匹配结果中选择记录。' : '');
    clear.hidden = !input.value && !select.value;
  }

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function highlight(index) {
    active = index;
    const buttons = list.querySelectorAll('[role="option"]');
    buttons.forEach((button, i) => button.setAttribute('aria-selected', String(i === active)));
    if (buttons[active]) {
      input.setAttribute('aria-activedescendant', buttons[active].id);
      buttons[active].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function choose(option) {
    select.value = option?.value || '';
    input.value = option?.value ? (settings.freeText ? option.value : option.label) : '';
    validate();
    close();
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function show() {
    const query = fold(input.value.trim());
    const terms = query.split(/\s+/).filter(Boolean);
    matches = options.filter(option => (!required || option.value) &&
      terms.every(term => option.search.includes(term)));
    if (query) matches.sort((a, b) => Number(fold(b.label).startsWith(query)) - Number(fold(a.label).startsWith(query)));
    if (settings.limit) matches = matches.slice(0, settings.limit);
    list.replaceChildren();
    active = -1;
    input.removeAttribute('aria-activedescendant');
    for (const [index, option] of matches.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.id = id + '-' + index;
      button.className = 'record-picker-option';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', 'false');
      const name = document.createElement('span');
      name.textContent = option.label;
      button.append(name);
      if (option.detail) {
        const detail = document.createElement('small');
        detail.textContent = option.detail;
        button.append(detail);
      }
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', event => { event.preventDefault(); choose(option); });
      list.append(button);
    }
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'record-picker-empty';
      empty.textContent = settings.freeText ? '没有匹配词条，可继续输入关键词。' : '没有匹配的记录，请换个关键词。';
      list.append(empty);
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    status.textContent = matches.length + ' 条匹配记录';
  }

  function search() {
    select.value = settings.freeText ? input.value : '';
    validate();
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    show();
  }

  input.addEventListener('focus', () => { if (settings.selectOnFocus) input.select(); show(); });
  input.addEventListener('click', () => { if (list.hidden) show(); });
  input.addEventListener('input', () => { if (!composing) search(); });
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; search(); });
  input.addEventListener('keydown', event => {
    if (composing || event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) show();
      if (matches.length) highlight(event.key === 'ArrowDown' ?
        (active + 1) % matches.length : (active <= 0 ? matches.length - 1 : active - 1));
    } else if (event.key === 'Enter' && !list.hidden) {
      event.preventDefault();
      if (matches.length && (!settings.freeText || active >= 0)) choose(matches[active < 0 ? 0 : active]);
      else close();
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  });
  input.addEventListener('blur', close);
  clear.addEventListener('pointerdown', event => event.preventDefault());
  clear.addEventListener('click', event => { event.preventDefault(); choose(null); input.focus(); show(); });

  return {
    refresh() {
      required = select.required;
      select.required = false;
      input.required = required;
      input.disabled = select.disabled || Boolean(select.closest('label')?.hidden);
      options = (settings.options ? settings.options() : [...select.options]).map(option => ({
        value: option.value, label: option.textContent, detail: option.dataset.detail || '',
        search: fold([option.textContent, option.dataset.search].filter(Boolean).join(' ')),
      }));
      input.value = settings.freeText ? select.value : (select.value ? select.selectedOptions[0]?.textContent || '' : '');
      close();
      validate();
    },
  };
}

const kpiState = { data: null, current: '', editing: null, deleting: null, busy: false, dirty: false, trigger: null };
const kpiDetail = element('kpi-detail');
const kpiEntry = element('kpi-entry');
const kpiForm = element('kpi-entry-form');
const kpiDelete = element('kpi-delete');
const kpiGoal = id => kpiState.data?.goals.find(goal => goal.id === id);
const kpiEntries = id => kpiState.data?.contributions.filter(entry => kpiIncludes(kpiGoal(id), entry.kpiId)) || [];
const kpiUnit = goal => goal.unit || (goal.entity === 'amount' ? '万人民币' : '个');
const kpiAddButton = (goal, label = '＋ 登记贡献', extra = '') => action(label, 'outline',
  'data-kpi-add="' + goal.id + '" ' + extra);
const kpiStatus = entry => entry.classificationRequired ? '待选择赢单分类' : entry.typeMismatch ? '统计方式已变更，待核实' : !entry.active ? '关联记录已删除' : entry.counted ? '已确认' :
  entry.status === 'confirmed' ? '达成日期待核实' : '待确认';

function kpiProgress(goal) {
  const percent = kpiPercent(goal.completed, goal.target);
  return '<div class="kpi-completion"><strong>' + kpiNumber(goal.completed) + '<small> / ' +
    kpiNumber(goal.target) + ' ' + kpiUnit(goal) + '</small></strong><span>' + percent + '%</span></div>' +
    '<progress max="' + Math.max(goal.target, 1) + '" value="' + Math.min(goal.completed, goal.target) + '" aria-label="' +
    esc(goal.name + '完成率 ' + percent + '%') + '"></progress>';
}

function renderKpis() {
  if (!kpiState.data) return;
  const { goals, contributions } = kpiState.data;
  const done = goals.filter(goal => goal.completed >= goal.target).length;
  const confirmed = contributions.filter(entry => entry.counted).length;
  const pending = contributions.filter(entry => entry.status === 'pending' && entry.active && !entry.classificationRequired && !entry.typeMismatch).length;
  const invalid = contributions.filter(entry => !entry.active || entry.classificationRequired || entry.typeMismatch || (entry.status === 'confirmed' && !entry.counted)).length;
  element('kpi-summary').innerHTML = [
    [done + ' / ' + goals.length, '指标已达标'], [confirmed, '已确认贡献记录'], [pending, '待确认贡献记录'], [invalid, '待核实记录'],
  ].map(([value, label]) => '<div><strong>' + value + '</strong><span>' + label + '</span></div>').join('');
  const search = fold(element('kpi-search').value.trim());
  const shown = goals.filter(goal => (fieldFilters.get('kpi')?.matches(goal) ?? true) &&
    fold([goal.name, ...kpiEntries(goal.id).map(entry => entry.entityLabel + ' ' + entry.siName + ' ' + entry.note)].join(' ')).includes(search));
  const order = element('kpi-sort').value;
  if (order) shown.sort((a, b) => (a.completed / a.target - b.completed / b.target) * (order === 'high' ? -1 : 1));
  element('kpi-cards').innerHTML = shown.length ? shown.map(goal => {
    const counted = kpiEntries(goal.id).filter(entry => entry.counted);
    const names = [...new Set(counted.map(entry => entry.entityLabel))].slice(0, 2);
    const flag = goal.completed >= goal.target ? pill('已达标', 'focus') :
      goal.pending ? pill(goal.pending + ' 条待确认') : '';
    return '<article class="kpi-card"><div class="kpi-card-head"><h3>' +
      action(esc(goal.name), 'name-link', 'data-kpi-open="' + goal.id + '"') + '</h3>' + flag +
      action('编辑', 'quiet', 'data-kpi-indicator-edit="' + goal.id + '" aria-label="编辑指标 ' + esc(goal.name) + '"') +
      '</div>' + kpiProgress(goal) + '<p class="kpi-card-support">' +
      (names.length ? esc(names.join(' · ')) : '尚未确认贡献') +
      '</p><div class="kpi-card-actions">' + action('查看贡献明细', 'quiet', 'data-kpi-open="' + goal.id + '"') +
      kpiAddButton(goal) + '</div></article>';
  }).join('') : '<div class="empty">没有符合筛选的指标。</div>';
}

function updateKpiData(data) {
  kpiState.data = data;
  element('kpi-add').disabled = false;
  element('kpi-indicator-add').disabled = false;
  fieldFilters.get('kpi').refresh();
  renderKpis();
  if (details.open && state.active) {
    const row = findRecord(state.active.kind, state.active.id);
    if (row) element('drawer-content').innerHTML = recordDetails(state.active.kind, row);
  }
  if (kpiDetail.open) renderKpiDetails();
}

function kpiHints(goal) {
  if (goal.children) return [];
  const rows = goal.entity === 'si' ? boards.si.rows : boards.project.rows;
  const registered = new Set(kpiEntries(goal.id).map(entry => entry.entityKind + '/' + entry.entityId));
  return rows.filter(row => {
    if (row.archived) return false;
    if (registered.has(goal.entity + '/' + row.id)) return false;
    if (goal.id === 'mbc_si') {
      const text = [...row.products, ...(row.notionNotes || []), ...row.updates].map(item => item.text).join(' ');
      return /MB-C|MBC|MeetingBoard/i.test(text);
    }
    if (['wins', 'wins_50v', 'wins_10v'].includes(goal.id)) return row.won === '是';
    if (goal.entity === 'amount' || closed(row)) return false;
    const text = [row.name, row.sku, row.summary, row.progress].join(' ');
    if (goal.id === 'proav') return /ProAV|CM20|CM50|AP08|CS10/i.test(text);
    if (goal.id === 'p1_p2') return /^P[2-6]$/.test(row.stage);
    if (goal.id === 'focus_new') return boards.si.rows.some(si => si.id === row.siId && si.focus) &&
      row.date >= kpiPeriod.start && row.date <= kpiPeriod.end;
    if (goal.id.startsWith('video_')) return /Upsell/i.test(text);
    return goal.id === 'headset_active' && /耳机|headset|WH\d|BH\d/i.test(text);
  });
}

function contributionCard(entry) {
  const definition = kpiGoal(entry.kpiId);
  const linked = entry.active && entry.entityKind !== 'none'
    ? openLink(entry.entityKind, { id: entry.entityId, name: entry.entityLabel }) : esc(entry.entityLabel);
  return '<article class="kpi-entry-card"><div class="block-heading"><strong>' + linked + '</strong>' +
    pill(kpiStatus(entry), entry.counted ? 'focus' : !entry.active ? 'risk' : '') + '</div>' +
    note([definition.name, entry.siName, entry.date, definition.entity === 'amount' ? kpiNumber(entry.amount) + ' ' + kpiUnit(definition) : ''].filter(Boolean).join(' · ')) +
    (entry.note ? '<p class="multiline">' + esc(entry.note) + '</p>' : '<p class="missing">达成依据待补。</p>') +
    (entry.sourceUrl ? '<div class="entry-meta">' + sourceLink({ label: '查看依据来源', url: entry.sourceUrl }) + '</div>' : '') +
    '<div class="actions">' + action('编辑贡献', 'quiet', 'data-kpi-edit="' + entry.id + '"') +
    action('删除贡献', 'quiet danger-text', 'data-kpi-delete="' + entry.id + '"') + '</div></article>';
}

function renderKpiDetails() {
  const goal = kpiGoal(kpiState.current);
  if (!goal) return;
  const entries = kpiEntries(goal.id);
  const hints = kpiHints(goal);
  const legacy = goal.children ? kpiState.data.contributions.filter(entry => entry.kpiId === goal.id) : [];
  const childSummary = goal.children ? goal.children.map(id => {
    const child = kpiGoal(id);
    return child ? '<article class="kpi-hint">' + action(esc(child.name), 'name-link', 'data-kpi-open="' + id + '"') +
      kpiProgress(child) + '</article>' : '<p class="missing">子指标已删除。</p>';
  }).join('') : '';
  const targetForm = '<form id="kpi-target-form" class="kpi-target-form"><label class="edit-field"><span>Q4 目标（' +
    kpiUnit(goal) + '）</span><input id="kpi-target-value" name="target" type="number" min="' +
    (goal.entity === 'amount' ? '0.000001' : '1') + '" step="' + (goal.entity === 'amount' ? '0.000001' : '1') +
    '" value="' + goal.target + '" required></label><button type="submit" class="outline">保存目标</button>' +
    '<p id="kpi-target-error" class="error" role="alert" hidden></p></form>';
  element('kpi-detail-content').innerHTML = '<div class="drawer-heading"><h2 id="kpi-detail-title">' +
    esc(goal.name) + '</h2><div class="detail-actions">' +
    action('编辑指标', 'outline', 'data-kpi-indicator-edit="' + goal.id + '"') + '</div><p>2026 Q4 · 已确认贡献</p>' + kpiProgress(goal) + '</div>' +
    section('统计口径', '<p>' + esc(goal.rule) + '</p>' + note(goal.children ?
      '目标、已确认完成数及待确认贡献按两个子指标相加。' : goal.entity === 'amount' ?
      '同一项目分批销售可分别登记，金额相加。' : '同一项目或 SI 在本项中计一次，可分别支撑其他指标。')) +
    (goal.children ? section('子指标汇总', '<div class="kpi-ledger">' + childSummary + '</div>') : section('目标', targetForm)) +
    section('贡献明细（' + entries.length + '）', entries.length ?
      '<div class="kpi-ledger">' + entries.map(contributionCard).join('') + '</div>' :
      '<p class="missing">尚未登记贡献。补充项目或 SI、达成日期及依据后可确认。</p>', kpiAddButton(goal)) +
    (legacy.length ? section('待分类的历史记录', '<p class="minor">编辑记录并选择 50V 或 10V 项目赢单后，可计入汇总。</p><div class="kpi-ledger">' +
      legacy.map(contributionCard).join('') + '</div>') : '') +
    (hints.length ? section('参考线索（' + hints.length + '）',
      '<p class="minor">由现有阶段、产品或客户记录筛出，达成时间及统计资格待确认。</p><div class="kpi-ledger">' +
      hints.map(row => '<article class="kpi-hint">' + openLink(goal.entity, row) +
        note([row.si, row.stage, row.units, row.date ? (row.dateKind || '记录日期') + ' ' + row.date : ''].filter(Boolean).join(' · ')) +
        kpiAddButton(goal, '核实并登记', 'data-entity-id="' + esc(row.id) + '"') + '</article>').join('') + '</div>') : '');
  element('kpi-target-form')?.addEventListener('submit', saveKpiTarget);
}

function openKpiDetails(id, trigger) {
  kpiState.current = id;
  kpiState.trigger = trigger;
  renderKpiDetails();
  if (!kpiDetail.open) kpiDetail.showModal();
  kpiDetail.scrollTop = 0;
  element('kpi-detail-close').focus();
}

async function saveKpiTarget(event) {
  event.preventDefault();
  const goal = kpiGoal(kpiState.current);
  const form = event.currentTarget;
  const submit = form.querySelector('button');
  setButtonBusy(submit, true);
  const output = element('kpi-target-error');
  output.hidden = true;
  try {
    const saved = await request('/api/kpi/targets/' + goal.id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: goal.revision, target: Number(element('kpi-target-value').value) }),
    });
    await afterMutation('已保存 KPI 目标', saved);
  } catch (error) { output.textContent = error.message; output.hidden = false; }
  finally { setButtonBusy(submit, false); }
}

function kpiRecordSection(kind, row) {
  if (!kpiState.data || !['si', 'project'].includes(kind)) return '';
  const entries = kpiState.data.contributions.filter(entry => entry.entityKind === kind && entry.entityId === row.id);
  return section('KPI 贡献', entries.length ? '<div class="pills">' + entries.map(entry =>
    action(esc(kpiGoal(entry.kpiId).name) + ' · ' + kpiStatus(entry), 'outline', 'data-kpi-open="' + entry.kpiId + '"')
  ).join('') + '</div>' : '<p class="missing">暂无 KPI 贡献记录。</p>',
    action('登记 KPI 贡献', 'outline', 'data-kpi-add="" data-record-kind="' + kind + '" data-entity-id="' + esc(row.id) + '"'));
}

function kpiOptions(options, selected) {
  return options.map(([value, label]) => '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
}

function openKpiEntry(entry, preset = {}) {
  const currentGoal = kpiGoal(kpiState.current);
  const defaultGoal = preset.kind === 'si' ? 'mbc_si' :
    preset.kind === 'project' && currentGoal?.entity !== 'project' ? 'wins' : kpiState.current || 'wins';
  const goalId = entry?.kpiId || preset.kpiId || defaultGoal;
  kpiState.editing = { entry, preset, goalId };
  kpiState.dirty = false;
  const record = entry || { status: 'pending', entityId: preset.entityId || '', entityKind: preset.kind || '' };
  element('kpi-entry-title').textContent = entry ? '编辑 KPI 贡献' : '登记 KPI 贡献';
  element('kpi-entry-fields').innerHTML =
    labelled('KPI 指标', '<select name="kpiId" required>' +
      '<option value="">请选择指标或赢单子项</option>' +
      kpiOptions(kpiState.data.goals.filter(goal => !goal.children).map(goal => [goal.id, goal.name]), goalId) + '</select>', true) +
    '<p id="kpi-entry-rule" class="kpi-form-note wide"></p>' +
    labelled('关联类型', '<select name="entityKind"></select>') +
    labelled('关联记录', '<select name="entityId"></select>') +
    labelled('销售记录名称', input('label', record.label), true) +
    labelled('确认状态', '<select name="status">' + kpiOptions([['pending', '待确认'], ['confirmed', '已确认']], record.status) + '</select>') +
    labelled('达成日期', input('date', record.date, 'date')) +
    labelled('贡献金额（万人民币）', input('amount', record.amount || '', 'number', 'min="0.000001" step="0.000001"')) +
    labelled('达成依据', textarea('note', record.note, 5), true) +
    labelled('依据来源链接', input('sourceUrl', record.sourceUrl, 'url'), true) +
    '<p id="kpi-evidence-hint" class="kpi-form-note wide"></p>';
  element('kpi-entry-error').hidden = true;
  updateKpiEntryFields(record);
  kpiEntry.showModal();
  kpiEntry.scrollTop = 0;
  kpiForm.elements.namedItem('kpiId').focus({ preventScroll: true });
}

function updateKpiEntryFields(record = {}) {
  const goal = kpiGoal(kpiForm.elements.namedItem('kpiId').value) || { entity: 'project', rule: '请选择 50V 或 10V 子指标，项目赢单将自动汇总。' };
  const kind = kpiForm.elements.namedItem('entityKind');
  const choices = goal.entity === 'amount' ? [['project', '项目'], ['si', 'SI'], ['none', '销售明细']] :
    [[goal.entity, goal.entity === 'si' ? 'SI' : '项目']];
  const previousKind = record.entityKind || kind.value;
  const selectedEntity = record.entityId || kpiForm.elements.namedItem('entityId').value;
  kind.innerHTML = kpiOptions(choices, previousKind);
  const previousEntity = !previousKind || previousKind === kind.value ? selectedEntity : '';
  const select = kpiForm.elements.namedItem('entityId');
  const rows = kind.value === 'none' ? [] : boards[kind.value].rows.filter(row => !row.archived || row.id === previousEntity);
  select.replaceChildren(new Option('请选择', ''), ...recordOptions(rows));
  select.value = previousEntity;
  select.closest('label').hidden = kind.value === 'none';
  select.required = kind.value !== 'none';
  mountRecordPicker(select, '关联记录');
  const label = kpiForm.elements.namedItem('label');
  label.closest('label').hidden = kind.value !== 'none';
  label.required = kind.value === 'none';
  const amount = kpiForm.elements.namedItem('amount');
  amount.closest('label').hidden = goal.entity !== 'amount';
  amount.required = goal.entity === 'amount';
  element('kpi-entry-rule').textContent = goal.rule;
  amount.closest('label').querySelector('span').textContent = '贡献数值（' + kpiUnit(goal) + '）';
  const confirmed = kpiForm.elements.namedItem('status').value === 'confirmed';
  const date = kpiForm.elements.namedItem('date');
  date.required = confirmed;
  date.min = confirmed ? kpiPeriod.start : '';
  date.max = confirmed ? (kpiToday() < kpiPeriod.end ? kpiToday() : kpiPeriod.end) : '';
  kpiForm.elements.namedItem('note').required = confirmed;
  syncKpiProjectEvidence();
}

function syncKpiProjectEvidence() {
  const kind = kpiForm.elements.namedItem('entityKind').value;
  const id = kpiForm.elements.namedItem('entityId').value;
  const key = kind + '/' + id;
  const selected = kind === 'project' ? findRecord('project', id) : null;
  const editing = kpiState.editing;
  const changed = editing.evidenceKey !== undefined && editing.evidenceKey !== key;
  for (const [name, projectKey, flag] of [['date', 'winDate', 'dateFromProject'], ['sourceUrl', 'projectUrl', 'sourceFromProject']]) {
    const control = kpiForm.elements.namedItem(name);
    const automatic = selected?.[projectKey] || '';
    if (automatic) control.value = automatic;
    else if (changed || control.dataset.fromProject === 'true' || (editing.evidenceKey === undefined && editing.entry?.[flag])) control.value = '';
    control.readOnly = Boolean(automatic);
    control.dataset.fromProject = String(Boolean(automatic));
  }
  editing.evidenceKey = key;
  element('kpi-evidence-hint').textContent = selected
    ? '依据链接' + (selected.projectUrl ? '已读取项目链接' : '未填写，可手动补充') + '；达成日期' +
      (selected.winDate ? '已读取赢单时间' : '未填写，可手动补充') + '。'
    : '关联项目后自动读取项目链接和赢单时间；缺失时可手动填写。';
}

async function saveKpiEntry(event) {
  event.preventDefault();
  if (kpiState.busy) return;
  const value = name => kpiForm.elements.namedItem(name).value;
  const record = Object.fromEntries(['kpiId', 'entityKind', 'entityId', 'label', 'status', 'date', 'note', 'sourceUrl'].map(name => [name, value(name)]));
  record.dateFromProject = kpiForm.elements.namedItem('date').dataset.fromProject === 'true';
  record.sourceFromProject = kpiForm.elements.namedItem('sourceUrl').dataset.fromProject === 'true';
  record.amount = kpiGoal(record.kpiId).entity === 'amount' ? Number(value('amount')) : 1;
  const entry = kpiState.editing.entry;
  const submit = element('kpi-entry-save');
  setButtonBusy(submit, true);
  kpiState.busy = true;
  element('kpi-entry-error').hidden = true;
  try {
    const saved = await request('/api/kpi/contributions' + (entry ? '/' + entry.id : ''), {
      method: entry ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: entry?.revision || 0, record }),
    });
    kpiState.current = record.kpiId;
    kpiEntry.close();
    if (await afterMutation('已保存 KPI 贡献', saved)) {
      if (details.open && state.active) openDetails(state.active.kind, findRecord(state.active.kind, state.active.id), state.trigger);
      openKpiDetails(record.kpiId, element('kpi-add'));
    }
  } catch (error) {
    element('kpi-entry-error').textContent = error.message;
    element('kpi-entry-error').hidden = false;
  } finally { kpiState.busy = false; setButtonBusy(submit, false); }
}

function closeKpiEntry() {
  if (kpiState.busy || (kpiState.dirty && !window.confirm('有尚未保存的贡献修改。关闭编辑？'))) return;
  kpiEntry.close();
}

async function deleteKpiEntry() {
  const entry = kpiState.deleting;
  const submit = element('kpi-delete-confirm');
  setButtonBusy(submit, true, '删除中…');
  kpiState.busy = true;
  element('kpi-delete-error').hidden = true;
  try {
    const saved = await request('/api/kpi/contributions/' + entry.id, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: entry.revision }),
    });
    kpiDelete.close();
    await afterMutation('已删除 KPI 贡献', saved);
  } catch (error) {
    element('kpi-delete-error').textContent = error.message;
    element('kpi-delete-error').hidden = false;
  } finally { setButtonBusy(submit, false); kpiState.busy = false; }
}

function initKpi() {
  element('kpi-add').addEventListener('click', () => openKpiEntry(null));
  element('kpi-indicator-add').addEventListener('click', () => openKpiIndicator());
  initKpiIndicatorEditor();
  createFieldFilter('kpi', 'KPI', () => kpiState.data?.goals || [], kpiFilterFields, renderKpis);
  for (const id of ['kpi-search', 'kpi-sort']) element(id).addEventListener(id === 'kpi-search' ? 'input' : 'change', renderKpis);
  element('kpi-reset').addEventListener('click', () => { element('kpi-search').value = ''; fieldFilters.get('kpi').clear(); });
  element('kpi-detail-close').addEventListener('click', () => kpiDetail.close());
  kpiDetail.addEventListener('close', () => {
    if (kpiState.trigger?.isConnected && !kpiEntry.open) kpiState.trigger.focus({ preventScroll: true });
  });
  kpiForm.addEventListener('input', () => { kpiState.dirty = true; });
  kpiForm.addEventListener('change', event => {
    if (['kpiId', 'entityKind', 'status'].includes(event.target.name)) updateKpiEntryFields();
    if (event.target.name === 'entityId') syncKpiProjectEvidence();
  });
  kpiForm.addEventListener('submit', saveKpiEntry);
  kpiEntry.addEventListener('cancel', event => { event.preventDefault(); closeKpiEntry(); });
  element('kpi-entry-close').addEventListener('click', closeKpiEntry);
  element('kpi-entry-cancel').addEventListener('click', closeKpiEntry);
  element('kpi-delete-confirm').addEventListener('click', deleteKpiEntry);
  element('kpi-delete-cancel').addEventListener('click', () => { if (!kpiState.busy) kpiDelete.close(); });
  kpiDelete.addEventListener('cancel', event => { if (kpiState.busy) event.preventDefault(); });
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const data = button.dataset;
    if (data.kpiOpen) openKpiDetails(data.kpiOpen, button);
    if (data.kpiIndicatorEdit) openKpiIndicator(kpiGoal(data.kpiIndicatorEdit));
    if (Object.hasOwn(data, 'kpiAdd')) openKpiEntry(null, { kpiId: data.kpiAdd, entityId: data.entityId, kind: data.recordKind });
    if (data.kpiEdit) openKpiEntry(kpiState.data.contributions.find(entry => entry.id === data.kpiEdit));
    if (data.kpiDelete) {
      kpiState.deleting = kpiState.data.contributions.find(entry => entry.id === data.kpiDelete);
      element('kpi-delete-error').hidden = true;
      kpiDelete.showModal();
      element('kpi-delete-cancel').focus();
    }
    if (data.open && kpiDetail.open) kpiDetail.close();
  });
}

const indicatorEditor = element('kpi-indicator-editor');
const indicatorForm = element('kpi-indicator-form');
const indicatorDelete = element('kpi-indicator-delete');
let indicatorEditing = null;
let indicatorBusy = false;
let indicatorDirty = false;

function openKpiIndicator(goal) {
  indicatorEditing = goal || null;
  indicatorDirty = false;
  const record = goal || { name: '', target: 1, entity: 'project', unit: '个', rule: '' };
  element('kpi-indicator-title').textContent = goal ? '编辑 KPI 指标' : '添加 KPI 指标';
  element('kpi-indicator-fields').innerHTML =
    labelled('指标名称', input('name', record.name, 'text', 'required'), true) +
    labelled('统计方式', '<select name="entity"' + (record.children ? ' disabled' : '') + '>' +
      kpiOptions([['project', '项目数量'], ['si', 'SI 数量'], ['amount', '数值累计']], record.entity) + '</select>') +
    labelled('统计单位', input('unit', record.unit || '个', 'text', 'required')) +
    labelled(record.children ? 'Q4 目标（自动汇总）' : 'Q4 目标', input('target', record.target, 'number',
      record.children ? 'readonly' : 'min="' + (record.entity === 'amount' ? '0.000001' : '1') +
        '" step="' + (record.entity === 'amount' ? '0.000001' : '1') + '" required')) +
    (record.children ? '<p class="kpi-form-note wide">目标和完成数按 50V、10V 两个子指标自动汇总。</p>' : '') +
    labelled('统计说明', textarea('rule', record.rule, 4), true);
  element('kpi-indicator-remove').hidden = !goal;
  element('kpi-indicator-error').hidden = true;
  indicatorEditor.showModal();
  indicatorEditor.scrollTop = 0;
  indicatorForm.elements.namedItem('name').focus();
}

function cancelKpiIndicator() {
  if (indicatorBusy || (indicatorDirty && !window.confirm('有尚未保存的指标修改。关闭编辑？'))) return;
  indicatorEditor.close();
}

async function saveKpiIndicator(event) {
  event.preventDefault();
  if (indicatorBusy) return;
  const current = indicatorEditing;
  const value = name => indicatorForm.elements.namedItem(name).value;
  const record = Object.fromEntries(['name', 'entity', 'unit', 'rule'].map(name => [name, value(name)]));
  record.target = Number(value('target'));
  const output = element('kpi-indicator-error');
  const save = element('kpi-indicator-save');
  output.hidden = true;
  indicatorBusy = true;
  setButtonBusy(save, true);
  try {
    const saved = await request('/api/kpi/indicators' + (current ? '/' + current.id : ''), {
      method: current ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: current?.revision || 0, record }),
    });
    indicatorEditor.close();
    if (await afterMutation('已保存 KPI 指标', saved)) openKpiDetails(saved.id, element('kpi-indicator-add'));
  } catch (error) { output.textContent = error.message; output.hidden = false; }
  finally { indicatorBusy = false; setButtonBusy(save, false); }
}

async function deleteKpiIndicator() {
  if (indicatorBusy) return;
  const current = indicatorEditing;
  const submit = element('kpi-indicator-delete-confirm');
  const output = element('kpi-indicator-delete-error');
  indicatorBusy = true;
  setButtonBusy(submit, true, '删除中…');
  output.hidden = true;
  try {
    const saved = await request('/api/kpi/indicators/' + current.id, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: current.revision }),
    });
    indicatorDelete.close();
    indicatorEditor.close();
    if (kpiState.current === current.id) kpiDetail.close();
    await afterMutation('已删除 KPI 指标', saved);
  } catch (error) { output.textContent = error.message; output.hidden = false; }
  finally { indicatorBusy = false; setButtonBusy(submit, false); }
}

function initKpiIndicatorEditor() {
  indicatorForm.addEventListener('submit', saveKpiIndicator);
  indicatorForm.addEventListener('input', () => { indicatorDirty = true; });
  indicatorForm.addEventListener('change', event => {
    if (event.target.name !== 'entity') return;
    const numeric = event.target.value === 'amount';
    const target = indicatorForm.elements.namedItem('target');
    target.step = numeric ? '0.000001' : '1';
    target.min = numeric ? '0.000001' : '1';
  });
  indicatorEditor.addEventListener('cancel', event => { event.preventDefault(); cancelKpiIndicator(); });
  element('kpi-indicator-close').addEventListener('click', cancelKpiIndicator);
  element('kpi-indicator-cancel').addEventListener('click', cancelKpiIndicator);
  element('kpi-indicator-remove').addEventListener('click', () => {
    element('kpi-indicator-delete-text').textContent = '删除「' + indicatorEditing.name + '」后，该指标及贡献将从看板中移除。';
    element('kpi-indicator-delete-error').hidden = true;
    indicatorDelete.showModal();
    element('kpi-indicator-delete-cancel').focus();
  });
  element('kpi-indicator-delete-cancel').addEventListener('click', () => { if (!indicatorBusy) indicatorDelete.close(); });
  indicatorDelete.addEventListener('cancel', event => { if (indicatorBusy) event.preventDefault(); });
  element('kpi-indicator-delete-confirm').addEventListener('click', deleteKpiIndicator);
}

import { stages as upStages, labels as upLabels, metrics as upMetrics, projectKey as upKey, groupProjects as upGroups } from './upsell-model.js';
const up={rows:[],loaded:false,busy:false,kind:'vc',query:'',scope:'active',editing:null,following:false};
const upExpandedProjects=new Set();
const upOwners=['Yanghai','Yue','Maocheng'];
const upToday=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const upButton=(text,attrs='',css='outline')=>'<button type="button" class="'+css+'" '+attrs+'>'+text+'</button>';
async function upRequest(method='GET',body){const r=await authorizedFetch('/api/upsell',{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||'保存失败，请重试');return data;}
async function loadUpsell(){if(up.busy)return;up.busy=true;try{up.rows=(await upRequest()).records;up.loaded=true;renderUpsell();}catch(e){element('up-message').textContent=e.message;}finally{up.busy=false;}}
function upRenderGoals(){
 if(!element('up-kpis'))return;
 const goals=state.data?.kpi?.goals||[];
 const ids=up.kind==='pos'?['service_revenue']:up.kind==='vc'?['video_active','video_import']:['headset_active'];
 element('up-kpis').innerHTML=goals.filter(g=>ids.includes(g.id)).map(g=>'<article class="up-kpi"><span>'+esc(g.name)+'</span>'+kpiProgress(g)+(accessScope==='upsell'?'':upButton('KPI 明细','data-kpi-open="'+g.id+'"','quiet')+(up.kind==='pos'?upButton('编辑 KPI','data-kpi-indicator-edit="'+g.id+'"','quiet'):upButton('登记贡献','data-kpi-add="'+g.id+'"','quiet')))+'</article>').join('');
 element('up-caption').textContent=up.kind==='pos'?'登记 POS 后自动计入对应 KPI；修改同一条记录会同步更新，不会重复累加。':'KPI 沿用现有已确认贡献；项目状态用于跟进，达成后可登记贡献。';
}
function upRows(){return up.rows.filter(r=>r.kind===up.kind&&(up.scope==='deleted'?r.deleted:!r.deleted&&(up.scope==='archived'?r.archived:!r.archived))&&(!up.query||fold([r.projectName,r.customer,r.product,r.owner,r.sales,r.stage].join(' ')).includes(fold(up.query))));}
function upTasks(key,scope=up.kind){return up.rows.filter(r=>r.kind==='task'&&r.scope===scope&&(r.groupId||'')===key&&!r.deleted&&(up.scope==='archived'?r.archived:!r.archived));}
function upTaskList(key,owner='',scope=up.kind){
 const tasks=upTasks(key,scope);return '<div class="up-tasks"><div class="up-task-title"><strong>待办</strong>'+upButton('＋ 添加待办','data-up-task-add="'+esc(key)+'" data-up-owner="'+esc(owner)+'"','quiet')+'</div>'+(tasks.length?tasks.map(t=>'<div class="up-task-row"><input type="checkbox" data-up-done="'+esc(t.id)+'" aria-label="完成待办 '+esc(t.content)+'"'+(t.stage==='完成'?' checked':'')+'><div class="'+(t.stage==='完成'?'up-done':'')+'">'+upButton(esc(t.content),'data-up-edit="'+esc(t.id)+'"','name-link')+'<span class="minor '+(t.due<upToday()&&t.stage!=='完成'?'up-overdue':'')+'">'+esc(t.due)+' · '+esc(t.owner)+'</span></div></div>').join(''):'<p class="minor">暂无待办</p>')+'</div>';
}
function upStageSelect(r){if(r.deleted)return '<span class="minor">已删除</span>'; const options=[...new Set([r.stage,...upStages[r.kind]])].filter(Boolean);return '<select class="up-inline-stage" data-up-stage="'+esc(r.id)+'" aria-label="'+esc(r.customer+' '+(r.product||r.projectName||'')+' 状态')+'">'+options.map(s=>'<option'+(s===r.stage?' selected':'')+'>'+esc(s)+'</option>').join('')+'</select>';}
function upHistory(r){const history=r.history||[];return '<details class="up-followups"><summary>跟进记录（'+history.length+'）</summary>'+(history.length?[...history].reverse().map(h=>'<p><time>'+esc(h.date)+'</time><span>'+esc(h.text)+'</span></p>').join(''):'<p class="minor">暂无跟进记录</p>')+'</details>'+(r.deleted?'':upButton('＋ 跟进记录','data-up-follow="'+esc(r.id)+'"','quiet'));}
function upRemoveButton(r){return upButton(r.deleted?'恢复':r.kind==='vc'?'删除产品':'删除项目','data-up-remove="'+esc(r.id)+'"','quiet up-remove');}
function upProjectButtons(r){return r.deleted?(r.projectDeleted?upButton('恢复项目','data-up-project="'+esc(r.id)+'" data-up-action="restore"','quiet'):''):upButton(r.archived?'取消项目归档':'归档项目','data-up-project="'+esc(r.id)+'" data-up-action="'+(r.archived?'unarchive':'archive')+'"','quiet')+upButton('删除项目','data-up-project="'+esc(r.id)+'" data-up-action="delete"','quiet up-remove');}
async function upProjectAction(row,action,button){
 const key=upKey(row);const records=up.rows.filter(r=>(r.kind==='vc'&&upKey(r)===key)||(r.kind==='task'&&r.scope==='vc'&&r.groupId===key));
 if(action==='delete'&&!confirm('删除项目“'+(row.projectName||row.customer)+'”及其全部产品和待办？跟进记录保留，可在“已删除”中恢复项目。'))return;
 button.disabled=true;try{const result=await upRequest('PUT',{projectAction:action,groupId:key,versions:records.map(r=>({id:r.id,revision:r.revision}))});const changed=new Map(result.records.map(r=>[r.id,r]));up.rows=up.rows.map(r=>changed.get(r.id)||r);renderUpsell();element('up-message').textContent=({delete:'项目已删除，可在“已删除”中恢复。',restore:'项目已恢复。',archive:'项目已归档，可在“已归档”中查看。',unarchive:'项目已取消归档。'})[action];}catch(e){element('up-message').textContent=e.message;}finally{button.disabled=false;}
}
function upProjectCard(g){const first=g.rows[0];if(up.kind==='vc')return '<article class="up-project-card"><details class="up-project-fold" data-up-fold="'+esc(g.key)+'"'+(upExpandedProjects.has(g.key)?' open':'')+'><summary><span class="up-project-label"><strong>'+esc(g.name)+'</strong><span class="minor">'+esc(g.customer)+' · '+g.rows.length+' 个产品</span></span></summary><div class="up-project-content"><div class="up-project-actions">'+upProjectButtons(g.rows.find(r=>r.projectDeleted)||first)+(first.deleted?'':upButton('＋ 产品','data-up-product-add="'+esc(first.id)+'"','quiet'))+'</div><div class="up-products">'+g.rows.map(r=>'<div><div class="up-product-heading">'+(r.deleted?esc(r.product):upButton(esc(r.product||'未填产品'),'data-up-edit="'+esc(r.id)+'"','name-link'))+upRemoveButton(r)+'</div>'+upStageSelect(r)+upHistory(r)+'</div>').join('')+'</div>'+(first.deleted?'':upTaskList(g.key,g.owner))+'</div></details></article>';return '<article class="up-project-card"><header><div><h4>'+esc(g.name)+'</h4><p class="minor">'+esc(g.customer)+'</p></div>'+(up.kind==='vc'?upProjectButtons(g.rows.find(r=>r.projectDeleted)||first):'')+(up.kind==='vc'?(first.deleted?'':upButton('＋ 产品','data-up-product-add="'+esc(first.id)+'"','quiet')):(first.deleted?'':upButton('编辑','data-up-edit="'+esc(first.id)+'"','quiet')))+ (up.kind==='se'?upRemoveButton(first):'')+'</header>'+
 (up.kind==='vc'?'<div class="up-products">'+g.rows.map(r=>'<div><div class="up-product-heading">'+(r.deleted?esc(r.product):upButton(esc(r.product||'未填产品'),'data-up-edit="'+esc(r.id)+'"','name-link'))+upRemoveButton(r)+'</div>'+upStageSelect(r)+upHistory(r)+'</div>').join('')+'</div>':upStageSelect(first)+upHistory(first))+
 (first.deleted?'':upTaskList(g.key,g.owner))+'</article>';}
function renderUpsell(){if(!element('up-list'))return;upRenderGoals();document.querySelectorAll('[data-up-kind]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.upKind===up.kind));b.classList.toggle('primary',b.dataset.upKind===up.kind);});
 const rs=upRows();const groups=upGroups(rs);element('up-add').hidden=['vc','se'].includes(up.kind);element('up-add').textContent=up.kind==='pos'?'＋ 登记 POS':'＋ 添加项目';
 let html='';if(['vc','se'].includes(up.kind)){
  const owners=[...upOwners,...new Set(groups.map(g=>g.owner||'未分配').filter(o=>!upOwners.includes(o)))];
  html='<div class="up-owner-grid">'+owners.map(owner=>{const items=groups.filter(g=>(g.owner||'未分配')===owner);return '<section class="up-owner-module"><header><h3>'+esc(owner)+' <small>'+items.length+' 个项目</small></h3>'+upButton('＋ 项目','data-up-add-owner="'+esc(owner==='未分配'?'':owner)+'"','outline')+'</header><div class="up-owner-body">'+(items.length?items.map(upProjectCard).join(''):'<div class="empty">暂无项目</div>')+'</div></section>';}).join('')+'</div>';
 }else if(up.kind==='cec'){
  html='<div class="up-cec-grid">'+rs.map(r=>'<article class="up-project-card"><header><h3>'+esc(r.projectName||r.customer)+'</h3>'+upButton('编辑','data-up-edit="'+esc(r.id)+'"','quiet')+'</header><p class="minor">客户：'+esc(r.customer)+' · 销售：'+esc(r.sales||'未填写')+' · 时间：'+esc(r.recordDate||r.visitDate||'未填写')+'</p>'+upStageSelect(r)+upHistory(r)+upTaskList(upKey(r),r.sales||r.owner)+'</article>').join('')+'</div>';
  if(!rs.length)html='<div class="empty">暂无项目，点击“添加项目”开始跟进。</div>';
 }else{
  const goals=state.data?.kpi?.goals||[];html='<section class="panel"><div class="up-table-scroll"><table class="up-table up-pos-table"><thead><tr><th>KPI</th><th>POS（万人民币）</th><th>时间</th><th></th></tr></thead><tbody>'+rs.sort((a,b)=>(b.posDate||'').localeCompare(a.posDate||'')).map(r=>'<tr><td>'+esc(goals.find(g=>g.id===(r.kpiId||'service_revenue'))?.name||'服务销售额')+'</td><td>'+kpiNumber(r.amount||0)+'</td><td>'+esc(r.posDate)+'</td><td>'+upButton('编辑','data-up-edit="'+esc(r.id)+'"','quiet')+'</td></tr>').join('')+'</tbody></table></div>'+(!rs.length?'<div class="empty">暂无 POS 登记</div>':'')+'</section><section class="panel up-service-tasks">'+upTaskList('','','pos')+'</section>';
 }
 element('up-list').innerHTML=html;element('up-count').textContent=['vc','se'].includes(up.kind)?groups.length+' 个项目':rs.length+' 条记录';
}
function upField(key,label,value='',type='text',options){return '<label class="up-field'+(type==='textarea'?' up-wide':'')+'"><span>'+label+'</span>'+(options?'<select name="'+key+'">'+options.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o];return '<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(l)+'</option>';}).join('')+'</select>':type==='textarea'?'<textarea name="'+key+'" rows="3">'+esc(value)+'</textarea>':'<input name="'+key+'" type="'+type+'" value="'+esc(value??'')+'"'+(type==='number'?' step="any"':'')+'>')+'</label>';}
function upEdit(row,defaults={}){
 up.following=false;
 const r=row?structuredClone(row):{kind:up.kind,stage:up.kind==='vc'?upStages.vc[3]:upStages[up.kind][0],owner:'Yanghai',history:[],...defaults};
 if(r.kind==='pos'){r.stage='已确认';r.kpiId||='service_revenue';r.posDate||=upToday();}
 if(['vc','se','cec'].includes(r.kind)){r.groupId||=row?upKey(row):crypto.randomUUID();r.projectName||=r.customer||'';}
 up.editing=r;const f=(k,l,t='text',opts)=>upField(k,l,r[k],t,opts);
 let body='';if(r.kind==='task')body=f('due','时间','date')+f('owner','负责人')+f('content','内容','textarea');
 else if(r.kind==='pos'){const gs=(state.data?.kpi?.goals||[]).filter(g=>g.entity==='amount');body=f('kpiId','KPI','text',gs.length?gs.map(g=>[g.id,g.name]):[['service_revenue','服务销售额']])+f('amount','POS（万人民币）','number')+f('posDate','时间','date');}
 else{body=f('projectName','项目')+f('customer','客户')+(r.kind==='cec'?f('recordDate','时间','date')+f('sales','销售'):f('owner','负责人','text',upOwners))+(r.kind==='vc'?f('product','产品'):'')+f('stage','状态','text',[...new Set([r.stage,...upStages[r.kind]])].filter(Boolean));}
 if(row&&r.kind!=='pos'&&r.kind!=='task')body+='<label class="up-field"><span>归档</span><input type="checkbox" name="archived"'+(r.archived?' checked':'')+'></label>';
 element('up-form-body').innerHTML='<div class="up-form-grid">'+body+'</div>';
 element('up-dialog-title').textContent=(row?'编辑':'添加')+(r.kind==='task'?'待办':r.kind==='pos'?' POS':r.kind==='vc'?'项目 / 产品':'项目');element('up-form-error').textContent='';element('up-dialog').showModal();
}
async function upPersist(old,changes){const result=await upRequest(old.id?'PUT':'POST',{id:old.id,revision:old.revision||0,record:{...old,...changes}});up.rows=up.rows.filter(r=>r.id!==result.record.id).concat(result.record);return result.record;}
function upFollow(row){up.editing=structuredClone(row);up.following=true;element('up-dialog-title').textContent='添加跟进 · '+(row.kind==='vc'?row.product:row.projectName||row.customer);element('up-form-body').innerHTML='<div class="up-form-grid">'+upField('followDate','时间',upToday(),'date')+upField('followText','内容','','textarea')+'</div>';element('up-form-error').textContent='';element('up-dialog').showModal();}
async function upSave(event){event.preventDefault();const button=element('up-save');button.disabled=true;try{const form=event.target;let values=Object.fromEntries(new FormData(form));if(up.following){if(!values.followDate||!values.followText.trim())throw Error('请填写跟进时间和内容');values={history:[...(up.editing.history||[]),{date:values.followDate,text:values.followText.trim()}]};}else if(form.elements.archived)values.archived=form.elements.archived.checked;await upPersist(up.editing,values);element('up-dialog').close();renderUpsell();if(up.editing.kind==='vc')await loadUpsell();if(up.editing.kind==='pos')loadBoard().catch(loadError);}catch(e){element('up-form-error').textContent=e.message;}finally{button.disabled=false;}}
async function upRemove(row,button){const restore=Boolean(row.deleted);if(!restore&&!confirm(row.kind==='vc'?'删除“'+row.product+'”？仅移除此产品，其他产品和项目待办保留，可在已删除中恢复。':'删除“'+(row.projectName||row.customer)+'”？可在已删除中恢复，跟进记录会保留。'))return;button.disabled=true;try{const result=await upRequest(restore?'PATCH':'DELETE',{id:row.id,revision:row.revision});up.rows=up.rows.map(r=>r.id===row.id?result.record:r);renderUpsell();element('up-message').textContent=restore?'已恢复':'已删除，可切换到“已删除”恢复。';}catch(e){element('up-message').textContent=e.message;}finally{button.disabled=false;}}
async function upInline(control,changes){control.disabled=true;const old=up.rows.find(r=>r.id===(control.dataset.upStage||control.dataset.upDone));try{await upPersist(old,changes);renderUpsell();}catch(e){if(control.dataset.upStage)control.value=old.stage;else control.checked=old.stage==='完成';element('up-message').textContent=e.message;}finally{control.disabled=false;}}
function initUpsell(){element('upsell-board').innerHTML='<div class="up-heading"><div><h2>Upsell 跟进</h2><p>项目 · 产品状态 · 待办</p></div>'+upButton('刷新','id="up-refresh"')+'</div><div class="up-tabs">'+Object.entries(upLabels).map(([k,l])=>upButton(l,'data-up-kind="'+k+'"')).join('')+'</div><div id="up-kpis" class="up-kpis"></div><p id="up-caption" class="up-caption"></p><div class="up-toolbar"><input id="up-search" type="search" aria-label="搜索 Upsell" placeholder="搜索项目或客户"><span id="up-count" class="minor"></span><select id="up-scope" aria-label="记录范围"><option value="active">当前记录</option><option value="archived">已归档</option><option value="deleted">已删除</option></select>'+upButton('＋ 添加项目','id="up-add"','primary')+'</div><p id="up-message" role="status"></p><div id="up-list"></div>';
 const dialog=document.createElement('dialog');dialog.id='up-dialog';dialog.className='up-dialog';dialog.innerHTML='<form id="up-form"><header class="up-heading"><h2 id="up-dialog-title"></h2>'+upButton('关闭','id="up-close"')+'</header><div id="up-form-body"></div><p id="up-form-error" role="alert" class="error"></p><footer><button class="primary" id="up-save" type="submit">保存</button></footer></form>';document.body.append(dialog);
 element('up-close').onclick=()=>dialog.close();element('up-form').onsubmit=upSave;element('up-refresh').onclick=loadUpsell;element('up-add').onclick=()=>upEdit();
 element('up-search').oninput=e=>{up.query=e.target.value;renderUpsell();};element('up-scope').onchange=e=>{up.scope=e.target.value;renderUpsell();};
 element('upsell-board').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;if(d.upKind){up.kind=d.upKind;up.query='';element('up-search').value='';renderUpsell();}if(d.upProject)upProjectAction(up.rows.find(r=>r.id===d.upProject),d.upAction,b);if(d.upFollow)upFollow(up.rows.find(r=>r.id===d.upFollow));if(d.upRemove)upRemove(up.rows.find(r=>r.id===d.upRemove),b);if(d.upEdit)upEdit(up.rows.find(r=>r.id===d.upEdit));if(d.upAddOwner!==undefined)upEdit(null,{owner:d.upAddOwner});if(d.upProductAdd){const r=up.rows.find(r=>r.id===d.upProductAdd);upEdit(null,{customer:r.customer,projectName:r.projectName||r.customer,owner:r.owner,archived:Boolean(r.archived),groupId:upKey(r)});}if(d.upTaskAdd!==undefined)upEdit(null,{kind:'task',stage:'待办',archived:up.scope==='archived',scope:up.kind,groupId:d.upTaskAdd,owner:d.upOwner,due:upToday()});});
 element('upsell-board').addEventListener('toggle',e=>{const t=e.target;if(!t.isConnected||!t.matches('details[data-up-fold]'))return;if(t.open)upExpandedProjects.add(t.dataset.upFold);else upExpandedProjects.delete(t.dataset.upFold);},true);
 element('upsell-board').addEventListener('change',e=>{const t=e.target;if(t.dataset.upStage)upInline(t,{stage:t.value});if(t.dataset.upDone)upInline(t,{stage:t.checked?'完成':'待办'});});renderUpsell();
}
initUpsell();

const editor = element('editor');
const form = element('record-form');
const deleteDialog = element('delete-record');
let editing;
let deleting;

function labelled(label, control, wide = false) {
  return '<label class="edit-field' + (wide ? ' wide' : '') + '"><span>' + esc(label) + '</span>' + control + '</label>';
}

function input(key, value, type = 'text', attributes = '') {
  const maxlength = ['text', 'url'].includes(type) ? ' maxlength="8000"' : '';
  return '<input type="' + type + '" name="' + key + '" value="' + esc(value) + '"' + maxlength + ' ' + attributes + '>';
}

function textarea(key, value, rows = 3) {
  return '<textarea name="' + key + '" rows="' + rows + '" maxlength="8000">' + esc(value) + '</textarea>';
}

function selectField(key, value, choices, empty) {
  const options = [
    ...(empty === undefined ? [] : [[empty, '']]), ...choices.map(choice => typeof choice === 'string' ? [choice, choice] : choice),
  ];
  return '<select name="' + key + '">' + options.map(([label, option]) =>
    '<option value="' + esc(option) + '"' + ((value ?? '') === option ? ' selected' : '') + '>' + esc(label) + '</option>'
  ).join('') + '</select>';
}

function entryRow(type, value = {}) {
  let content = '';
  if (type === 'entries') {
    content = labelled('内容', textarea('text', value.text, 2), true) +
      labelled('日期', input('date', value.date, 'date')) +
      labelled('记录类型', input('kind', value.kind)) +
      labelled('来源名称', input('source-label', value.source?.label)) +
      labelled('来源链接', input('source-url', value.source?.url, 'url'));
  } else if (type === 'todos') {
    content = labelled('待办内容', textarea('text', value.text, 2), true) +
      labelled('截止日期', input('date', value.date, 'date')) +
      labelled('完成状态', '<select name="done"><option value="no">未完成</option><option value="yes"' + (value.done ? ' selected' : '') + '>已完成</option></select>');
  } else if (type === 'links') {
    content = labelled('来源名称', input('source-label', value.label)) +
      labelled('来源链接', input('source-url', value.url, 'url'));
  } else {
    content = labelled('字段名称', input('label', value.label)) +
      labelled('字段内容', input('value', value.value));
  }
  const label = type === 'entries' ? '记录' : type === 'todos' ? '待办' : type === 'links' ? '来源' : '字段';
  return '<div class="repeat-row"><div class="edit-grid">' + content + '</div>' +
    action('移除' + label, 'quiet danger-text', 'data-remove-entry') + '</div>';
}

function repeatField(key, label, type, items = []) {
  const singular = type === 'entries' ? '记录' : type === 'todos' ? '待办' : type === 'links' ? '来源' : '字段';
  const expanded = editing.group === key || ['followups', 'todos'].includes(key) || (key === 'updates' && editing.kind === 'si' && !editing.row);
  return '<details class="repeat-field wide" data-repeat="' + key + '" data-type="' + type + '"' +
    (expanded ? ' open' : '') + '><summary>' + esc(label) + ' <span class="repeat-count">' + items.length + '</span></summary>' +
    '<div class="repeat-rows">' + items.map(item => entryRow(type, item)).join('') + '</div>' +
    action('＋ 添加' + singular, 'outline', 'data-add-entry') + '</details>';
}

function buildField([key, label, type = 'text', choices], value) {
  if (['entries', 'todos', 'links', 'extra'].includes(type)) return repeatField(key, label, type, value);
  if (type === 'boolean') return labelled(label, '<select name="' + key + '"><option value="no">否</option><option value="yes"' +
    (value ? ' selected' : '') + '>是</option></select>');
  if (type === 'scale') return labelled(label, input(key, value, 'text', 'placeholder="例如 50V、30-50V 或头部"'));
  if (key === 'won') return labelled(label, selectField(key, value === '是' ? '是' : '否', choices.map(choice => [projectWinLabel(choice), choice])));
  if (type === 'choice') return labelled(label, selectField(key, value, choices, key === 'loan' ? '未确认' : '未填写'));
  if (type === 'relation') return labelled(label, selectField(key, value, boards.si.rows.map(si => [si.name, si.id]), '无关联 SI'));
  if (type === 'lines') return labelled(label + '（每行一项）', textarea(key, (value ?? []).join('\n'), 2), true);
  if (type === 'long') return labelled(label, textarea(key, value), true);
  return labelled(label, input(key, value, ['date', 'url'].includes(type) ? type : 'text', type === 'required' ? 'required' : ''));
}

function updateConditions(syncSales = false) {
  if (!['project', 'consultation'].includes(editing?.kind)) return;
  if (editing.kind === 'project') {
  const loan = form.elements.namedItem('loan').value === '是';
  for (const key of ['loanDate', 'loanReturn', 'loanProduct']) {
    const field = form.elements.namedItem(key);
    field.disabled = !loan;
    field.closest('label').hidden = !loan;
  }
  const won = form.elements.namedItem('won').value === '是';
  const winDate = form.elements.namedItem('winDate');
  winDate.disabled = !won;
  winDate.required = won;
  winDate.closest('label').hidden = !won;
  }
  const related = findRecord('si', form.elements.namedItem('siId').value);
  const name = form.elements.namedItem('si');
  name.disabled = Boolean(related);
  name.closest('label').hidden = Boolean(related);
  if (related) name.value = related.name;
  if (syncSales) form.elements.namedItem('sales').value = related?.sales || '';
}

function openEditor(kind, row, options = {}) {
  editing = { kind, row, conversion: options.conversion, group: options.group, trigger: options.trigger, dirty: false, busy: false,
    detailScrollTop: details.open && state.active?.kind === kind && state.active?.id === row?.id ? details.scrollTop : undefined };
  element('editor-title').textContent = options.conversion ? '转为项目 · ' + options.conversion.name : (row ? '编辑 ' + row.name : '添加' + recordLabel(kind));
  element('editor-save').textContent = options.conversion ? '创建并关联项目' : '保存';
  const data = row || options.data || { ...(options.si ? { siId: options.si } : {}), ...(kind === 'consultation' ? { consultedDate: kpiToday(), stage: '待澄清需求' } : {}) };
  element('editor-fields').innerHTML = fields[kind].map(([title, group]) => {
    const alwaysOpen = ['借测', '赢单', '需求与方案', '进展与安排'].includes(title) || group.some(([key, , type]) => type === 'required' || key === options.group);
    return '<details class="editor-group"' + (alwaysOpen ? ' open' : '') + '><summary>' + esc(title) +
      '</summary><div class="edit-grid">' + group.map(field => buildField(field, data[field[0]])).join('') + '</div></details>';
  }).join('');
  if (['project', 'consultation'].includes(kind)) {
    const relation = form.elements.namedItem('siId');
    relation.replaceChildren(new Option('无关联 SI', ''), ...recordOptions(boards.si.rows));
    relation.value = data.siId || '';
    mountRecordPicker(relation, '关联 SI');
  }
  if (kind === 'consultation') {
    const stage = form.elements.namedItem('stage');
    if (!data.projectId) stage.querySelector('option[value="已转项目"]')?.remove();
    stage.disabled = Boolean(data.projectId);
  }
  if (kind === 'si' && row?.potential26) {
    const sourceValue = row.potential26.value ? row.potential26.value.replace(/V$/i, '') + 'V' : '';
    form.elements.namedItem('tier').closest('label').insertAdjacentHTML('afterend',
      '<div class="wide scale-source"><p class="minor">' + esc(row.potential26.field) + ' · ' +
      esc(sourceValue || '待补') + '</p>' + action('使用中腰表规模', 'quiet', 'id="use-source-tier"') + '</div>');
    element('use-source-tier').addEventListener('click', () => {
      form.elements.namedItem('tier').value = sourceValue;
      editing.dirty = true;
    });
  }
  element('editor-error').hidden = true;
  updateConditions(!row && !options.conversion);
  editor.showModal();
  editor.scrollTop = 0;
  if (options.group) {
    const field = element('editor-fields').querySelector('[data-repeat="' + options.group + '"]') ||
      form.elements.namedItem(options.group)?.closest('label');
    field?.scrollIntoView({ block: 'start' });
    (field?.querySelector('textarea, input:not([hidden]), select:not([hidden])') || field?.querySelector('[data-add-entry], summary'))?.focus({ preventScroll: true });
  } else {
    form.elements.namedItem('name').focus({ preventScroll: true });
  }
}

function openConsultationConversion(row, trigger) {
  if (!row) return;
  if (row.projectId) { openDetails('project', findRecord('project', row.projectId), trigger); return; }
  openEditor('project', null, { data: consultationProjectDraft(row), conversion: row, trigger });
}

function readRecord(kind) {
  const value = key => form.elements.namedItem(key).value;
  const list = key => [...form.querySelectorAll('[data-repeat="' + key + '"] .repeat-row')];
  const readEntry = (field, type) => {
    const read = name => field.querySelector('[name="' + name + '"]').value;
    if (type === 'extra') return { label: read('label'), value: read('value') };
    if (type === 'todos') return { text: read('text'), date: read('date'), done: read('done') === 'yes' };
    const source = { label: read('source-label'), url: read('source-url') };
    return type === 'links' ? source : { text: read('text'), date: read('date'), kind: read('kind'), source };
  };
  const record = {};
  for (const [key, , type] of allFields(kind)) {
    if (['entries', 'todos', 'links', 'extra'].includes(type)) record[key] = list(key).map(field => readEntry(field, type));
    else if (type === 'lines') record[key] = value(key).split('\n').map(line => line.trim()).filter(Boolean);
    else record[key] = type === 'boolean' ? value(key) === 'yes' : value(key);
  }
  return record;
}

function cancelEditor() {
  if (editing.busy || (editing.dirty && !window.confirm('有尚未保存的修改。关闭编辑？'))) return;
  editor.close();
}

function handleRepeat(event) {
  const control = event.target.closest('[data-add-entry], [data-remove-entry]');
  if (!control) return;
  const repeat = control.closest('[data-repeat]');
  const rows = repeat.querySelector('.repeat-rows');
  if (control.hasAttribute('data-add-entry')) {
    rows.insertAdjacentHTML('beforeend', entryRow(repeat.dataset.type));
    rows.lastElementChild.querySelector('input, textarea').focus();
  } else {
    const row = control.closest('.repeat-row');
    const focus = row.nextElementSibling?.querySelector('input, textarea') || repeat.querySelector('[data-add-entry]');
    row.remove();
    focus.focus();
  }
  repeat.querySelector('.repeat-count').textContent = rows.childElementCount;
  editing.dirty = true;
}

function mutate(kind, row, method, record) {
  return request('/api/records/' + kind + (row ? '/' + encodeURIComponent(row.id) : ''), {
    method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: row?.revision ?? 0, record }),
  });
}

async function afterMutation(message, saved) {
  if (!saved?.applied) {
    try { await loadBoard(); }
    catch (error) {
      flash(message + '。列表暂时无法刷新，请重新加载。');
      return false;
    }
  }
  flash(message);
  scheduleBoardSync();
  return true;
}

async function saveEditor(event) {
  event.preventDefault();
  if (editing.busy) return;
  const { kind, row } = editing;
  const record = readRecord(kind);
  const save = element('editor-save');
  editing.busy = true;
  setButtonBusy(save, true);
  element('editor-cancel').disabled = true;
  element('editor-error').hidden = true;
  try {
    const conversion = editing.conversion;
    const saved = conversion ? await request('/api/records/consultation/' + encodeURIComponent(conversion.id) + '/convert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: conversion.revision, record }),
    }) : await mutate(kind, row, row ? 'PUT' : 'POST', record);
    if (await afterMutation(conversion ? '已转为项目，原方案咨询已保留并关联' : '已保存' + recordLabel(kind), saved)) {
      editor.close();
      if (conversion && details.open && state.active?.kind === 'consultation') state.detailHistory.push({ ...state.active, scrollTop: details.scrollTop });
      openDetails(kind, findRecord(kind, saved.id), editing.trigger, { scrollTop: editing.detailScrollTop });
    } else {
      editor.close();
      if (details.open) details.close();
    }
  } catch (error) {
    const output = element('editor-error');
    output.textContent = error.message;
    output.hidden = false;
  } finally {
    editing.busy = false;
    setButtonBusy(save, false);
    element('editor-cancel').disabled = false;
  }
}

function askDelete(kind, row) {
  if (!row) return;
  deleting = { kind, row };
  const consequence = kind === 'si' ? '。关联项目和方案咨询将保留。' : kind === 'consultation' ? '。已经转化的项目会保留。' : '。该项目也会从关联 SI 的项目列表中移除。';
  element('delete-text').textContent = '删除「' + row.name + '」' + consequence;
  element('delete-error').hidden = true;
  deleteDialog.showModal();
  element('delete-cancel').focus();
}

async function confirmDelete() {
  const { kind, row } = deleting;
  const confirm = element('delete-confirm');
  setButtonBusy(confirm, true, '删除中…');
  element('delete-cancel').disabled = true;
  element('delete-error').hidden = true;
  try {
    const saved = await mutate(kind, row, 'DELETE');
    const refreshed = await afterMutation('已删除' + recordLabel(kind), saved);
    deleteDialog.close();
    if (!refreshed || (state.active?.kind === kind && state.active?.id === row.id)) details.close();
  } catch (error) {
    const output = element('delete-error');
    output.textContent = error.message;
    output.hidden = false;
  } finally {
    setButtonBusy(confirm, false);
    element('delete-cancel').disabled = false;
  }
}

form.addEventListener('submit', saveEditor);
form.addEventListener('click', handleRepeat);
form.addEventListener('input', () => { editing.dirty = true; });
form.addEventListener('change', event => {
  if (['siId', 'loan', 'won'].includes(event.target.name)) updateConditions(event.target.name === 'siId');
});
form.addEventListener('invalid', event => {
  let group = event.target.closest('details');
  while (group) {
    group.open = true;
    group = group.parentElement.closest('details');
  }
}, true);
editor.addEventListener('cancel', event => { event.preventDefault(); cancelEditor(); });
element('editor-close').addEventListener('click', cancelEditor);
element('editor-cancel').addEventListener('click', cancelEditor);
element('delete-cancel').addEventListener('click', () => deleteDialog.close());
deleteDialog.addEventListener('cancel', event => {
  if (element('delete-confirm').disabled) event.preventDefault();
});
element('delete-confirm').addEventListener('click', confirmDelete);
initApp();

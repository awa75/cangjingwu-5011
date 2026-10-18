#!/usr/bin/env node
/**
 * 藏经坞 · 冒烟测试（新站）
 *
 * 只挑「删掉那些功能之后仍然必须成立」的边界，不追求条数：
 *   - 坞主 / 会员 / 匿名 三档权限互相不能越界
 *   - 投稿进待审区；未收录对外一律 403，收录后才放开
 *   - 会员只能看到自己投的文件
 *   - 文件夹 / 文稿 / 绑定文件 / 打包下载 / 分享 / 邀请码 的完整闭环
 *
 * 用法（先起服务）：
 *   node scripts/smoke.mjs
 *   SMOKE_BASE=http://127.0.0.1:8080 node scripts/smoke.mjs
 *
 * 坞主凭据默认读 .env 的 OWNER_USERNAME / OWNER_PASSWORD，不写在脚本里。
 * 退出码：0 全过；1 有失败。测试数据最后会清干净，并复查残留。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 读 .env（忽略注释与空行）；不导出、不打印 */
function loadEnv() {
  const file = path.join(repoRoot, '.env');
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const BASE = (process.env.SMOKE_BASE ?? `http://127.0.0.1:${env.PORT || 8081}`).replace(/\/+$/, '');
const OWNER_USER = process.env.OWNER_USER ?? env.OWNER_USERNAME ?? 'keeper';
const OWNER_PASS = process.env.OWNER_PASS ?? env.OWNER_PASSWORD ?? '';

/** 1×1 PNG：真实图片字节，让缩略图链路有机会走通（假 PNG 会让 ffmpeg 报 inflate 错） */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let pass = 0;
const failures = [];
const created = {
  files: [],
  documents: [],
  collections: [],
  shares: [],
  members: [],
  codes: [],
  surveys: [],
};

function section(title) {
  console.log(`\n── ${title} ──`);
}
function check(label, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ' —— ' + detail : ''}`);
    console.log(`  ✗ ${label}${detail ? ' —— ' + detail : ''}`);
  }
}

async function api(method, urlPath, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON（如 /media 的二进制） */
  }
  return { status: res.status, json, data: json?.data, text };
}

async function uploadFiles(token, files) {
  const fd = new FormData();
  for (const f of files) fd.append('file', new Blob([f.bytes], { type: f.mime }), f.name);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE}/api/files/upload`, { method: 'POST', headers, body: fd });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { status: res.status, json, data: json?.data, text };
}

/** 只取状态码 —— 用来验 /media 这类二进制响应 */
async function probe(urlPath) {
  const res = await fetch(BASE + urlPath);
  return { status: res.status, type: res.headers.get('content-type') };
}

/** GET 并顺手收下访客 cookie（问卷「同一浏览器一份」靠它） */
async function getWithCookie(urlPath) {
  const res = await fetch(BASE + urlPath);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  const jars = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const vid = jars.map((c) => /cjw_vid=([^;]+)/.exec(c)?.[1]).find(Boolean) ?? '';
  return { status: res.status, json, data: json?.data, vid, text };
}

/** POST 并带上指定的访客 cookie */
async function postWithCookie(urlPath, body, vid) {
  const headers = { 'Content-Type': 'application/json' };
  if (vid) headers.Cookie = `cjw_vid=${vid}`;
  const res = await fetch(BASE + urlPath, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { status: res.status, json, data: json?.data, text };
}

const main = async () => {
  console.log(`冒烟对象：${BASE}`);
  if (!OWNER_PASS) console.log('  ! 未从 .env 读到 OWNER_PASSWORD，后面登录会失败');

  // ---------------------------------------------------------------- 0
  section('0. 服务可达');
  const health = await api('GET', '/api/health');
  check('GET /api/health 200', health.status === 200, `实际 ${health.status}`);
  check('返回 node 版本', typeof health.data?.node === 'string', JSON.stringify(health.data));

  // ---------------------------------------------------------------- 1
  section('1. 坞主鉴权');
  const loginRes = await api('POST', '/api/auth/login', {
    body: { username: OWNER_USER, password: OWNER_PASS },
  });
  check('坞主登录 200', loginRes.status === 200, `实际 ${loginRes.status} ${loginRes.text.slice(0, 120)}`);
  const ownerToken = loginRes.data?.token;
  check('拿到三段式 JWT', typeof ownerToken === 'string' && ownerToken.split('.').length === 3);

  const me = await api('GET', '/api/auth/me', { token: ownerToken });
  check('GET /api/auth/me 200', me.status === 200);
  check('isOwner = true', me.data?.isOwner === true, JSON.stringify(me.data));

  check('匿名访问 /api/owner/stats → 401', (await api('GET', '/api/owner/stats')).status === 401);
  check('匿名访问 /api/files → 401', (await api('GET', '/api/files')).status === 401);

  // ---------------------------------------------------------------- 2
  section('2. 邀请码 + 会员注册');
  const codeRes = await api('POST', '/api/owner/codes', {
    token: ownerToken,
    body: { count: 1, level: 1, maxUses: 1, note: 'smoke-test' },
  });
  check('生成邀请码 201', codeRes.status === 201, `实际 ${codeRes.status} ${codeRes.text.slice(0, 120)}`);
  const inviteCode = codeRes.data?.items?.[0]?.code;
  check('拿到邀请码字符串', typeof inviteCode === 'string' && inviteCode.length > 0);
  if (inviteCode) created.codes.push(inviteCode);

  const uname = `smoke_${Date.now().toString(36)}`;
  const regRes = await api('POST', '/api/auth/register', {
    body: { code: inviteCode, username: uname, password: 'smoke-pass-1234', nickname: '冒烟会员' },
  });
  check('注册 201', regRes.status === 201, `实际 ${regRes.status} ${regRes.text.slice(0, 160)}`);
  const memberToken = regRes.data?.token;
  const memberId = regRes.data?.user?.id;
  check('注册返回 token', typeof memberToken === 'string');
  if (memberId) created.members.push(memberId);

  const memberMe = await api('GET', '/api/auth/me', { token: memberToken });
  check('会员 isOwner = false', memberMe.data?.isOwner === false, JSON.stringify(memberMe.data));

  // ---------------------------------------------------------------- 3
  section('3. 投稿 → 待审');
  const up = await uploadFiles(memberToken, [
    { name: 'smoke-note.md', mime: 'text/markdown', bytes: Buffer.from('# 冒烟文稿\n\n这是投稿正文。\n') },
    { name: 'smoke-pixel.png', mime: 'image/png', bytes: PNG_1X1 },
    { name: 'smoke-drop.txt', mime: 'text/plain', bytes: Buffer.from('这部分会被退回。\n') },
  ]);
  check('投稿 201', up.status === 201, `实际 ${up.status} ${up.text.slice(0, 200)}`);
  const items = up.data ?? [];
  const fileIds = items.map((i) => i.id);
  check('投了三个文件', fileIds.length === 3, `实际 ${fileIds.length}`);
  created.files.push(...fileIds);
  const mdId = items.find((i) => i.originalName === 'smoke-note.md')?.id ?? fileIds[0];
  const pngId = items.find((i) => i.originalName === 'smoke-pixel.png')?.id ?? fileIds[1];
  const dropId = items.find((i) => i.originalName === 'smoke-drop.txt')?.id ?? fileIds[2];

  check('入库即 pending', items.every((i) => i.reviewStatus === 'pending'), JSON.stringify(items[0] ?? {}));
  check('记下投稿人', items.every((i) => i.uploadedBy === memberId), `uploadedBy=${items[0]?.uploadedBy} memberId=${memberId}`);

  // ---------------------------------------------------------------- 4
  section('4. 未收录的对外闸门');
  check('匿名取未收录文件 → 403', (await probe(`/media/files/${pngId}`)).status === 403);
  check('匿名取未收录缩略图 → 403', (await probe(`/media/thumbs/${pngId}`)).status === 403);
  check('会员不登录取文件 → 401', (await probe(`/api/files/${mdId}/raw`)).status === 401);

  const selfRaw = await fetch(`${BASE}/api/files/${mdId}/raw`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  check('会员取自己文件 → 200', selfRaw.status === 200, `实际 ${selfRaw.status}`);

  // ---------------------------------------------------------------- 4.5
  section('4.5 审核预览票（坞主要看得见才敢批）');
  const ownerUp = await uploadFiles(ownerToken, [
    { name: 'smoke-owner.md', mime: 'text/markdown', bytes: Buffer.from('坞主自投\n') },
  ]);
  const ownerFileId = ownerUp.data?.[0]?.id;
  if (ownerFileId) created.files.push(ownerFileId);

  const ticket = await api('POST', `/api/files/${pngId}/preview-ticket`, { token: ownerToken });
  check('坞主换预览票 200', ticket.status === 200, `实际 ${ticket.status} ${ticket.text.slice(0, 120)}`);
  const ticketUrl = String(ticket.data?.url ?? '');
  check('票地址形状对（/api/preview/…）', ticketUrl.startsWith('/api/preview/'), ticketUrl.slice(0, 40));
  if (ticketUrl) {
    check('凭票取未收录文件 → 200', (await probe(ticketUrl)).status === 200);
    const ranged = await fetch(BASE + ticketUrl, { headers: { Range: 'bytes=0-1' } });
    check('凭票支持 Range（视频可拖进度条）', ranged.status === 206, `实际 ${ranged.status}`);
    check('票地址带 no-store', (await fetch(BASE + ticketUrl)).headers.get('cache-control') === 'no-store');
  }
  check('匿名换票 → 401', (await api('POST', `/api/files/${pngId}/preview-ticket`)).status === 401);
  check('伪造票 → 401', (await probe('/api/preview/forged.token.here')).status === 401);
  if (ownerFileId) {
    const cross = await api('POST', `/api/files/${ownerFileId}/preview-ticket`, { token: memberToken });
    check('会员不能给别人的文件换票 → 403', cross.status === 403, `实际 ${cross.status}`);
  }
  check(
    '会员能给自己投的文件换票 → 200',
    (await api('POST', `/api/files/${mdId}/preview-ticket`, { token: memberToken })).status === 200,
  );

  // ---------------------------------------------------------------- 5
  section('5. 越权边界');
  const memberReview = await api('PATCH', `/api/files/${mdId}/review`, {
    token: memberToken,
    body: { action: 'approve' },
  });
  check('会员不能审核 → 403', memberReview.status === 403, `实际 ${memberReview.status}`);
  check(
    '会员不能看坞主统计 → 403',
    (await api('GET', '/api/owner/stats', { token: memberToken })).status === 403,
  );
  check(
    '会员不能发邀请码 → 403',
    (await api('GET', '/api/owner/codes', { token: memberToken })).status === 403,
  );
  check(
    '会员不能读文稿管理接口 → 403',
    (await api('GET', '/api/documents', { token: memberToken })).status === 403,
  );

  const memberList = await api('GET', '/api/files?pageSize=100', { token: memberToken });
  const foreign = (memberList.data?.items ?? []).filter((i) => i.uploadedBy !== memberId);
  check('会员列表只返回自己投的', foreign.length === 0, `混入 ${foreign.length} 条他人文件`);

  // ---------------------------------------------------------------- 6
  section('6. 收录审核 = 发布');
  const counts = await api('GET', '/api/files/meta/review', { token: ownerToken });
  check('审核计数 200', counts.status === 200);
  check('待审数 ≥ 3', Number(counts.data?.pending) >= 3, JSON.stringify(counts.data));

  // ---- 6.1 影像：收录后进文库「影像」区
  const approveImg = await api('PATCH', `/api/files/${pngId}/review`, {
    token: ownerToken,
    body: { action: 'approve' },
  });
  check('收录图片 200', approveImg.status === 200, `实际 ${approveImg.status} ${approveImg.text.slice(0, 120)}`);
  check('状态变 approved', approveImg.data?.reviewStatus === 'approved', JSON.stringify(approveImg.data?.reviewStatus));
  check('写下 reviewedAt', Boolean(approveImg.data?.reviewedAt), String(approveImg.data?.reviewedAt));
  check('收录后匿名取文件 → 200', (await probe(`/media/files/${pngId}`)).status === 200);
  const thumb = await probe(`/media/thumbs/${pngId}`);
  check('收录后缩略图不被拒绝（200 或 404）', [200, 404].includes(thumb.status), `实际 ${thumb.status}`);

  const mediaList = await api('GET', '/api/public/media');
  check('公开影像接口 200', mediaList.status === 200);
  check(
    '影像区里出现这张图',
    (mediaList.data?.items ?? []).some((m) => m.id === pngId),
    `共 ${mediaList.data?.items?.length ?? 0} 件`,
  );

  // ---- 6.2 文稿：收录后自动升格成文库文稿（「收录即发布」）
  const approveMd = await api('PATCH', `/api/files/${mdId}/review`, {
    token: ownerToken,
    body: { action: 'approve' },
  });
  check('收录文本投稿 200', approveMd.status === 200, `实际 ${approveMd.status}`);
  const promoted = approveMd.data?.promotedDocument;
  check('返回 promotedDocument', Boolean(promoted?.id), JSON.stringify(promoted ?? null));
  if (promoted?.id) created.documents.push(promoted.id);

  const afterDocs = await api('GET', '/api/public/documents');
  check(
    '升格的文稿出现在公开文库',
    (afterDocs.data?.items ?? []).some((d) => d.id === promoted?.id),
    `共 ${afterDocs.data?.items?.length ?? 0} 篇`,
  );

  // 重复收录不该再建第二篇（幂等）
  const again = await api('PATCH', `/api/files/${mdId}/review`, {
    token: ownerToken,
    body: { action: 'approve' },
  });
  check('重复收录不再升格', again.status === 200 && !again.data?.promotedDocument, JSON.stringify(again.data?.promotedDocument ?? null));

  // ---- 6.3 退回：不得对外
  const reject = await api('PATCH', `/api/files/${dropId}/review`, {
    token: ownerToken,
    body: { action: 'reject', note: '冒烟测试退回' },
  });
  check('退回 200', reject.status === 200);
  check('退回原因写入', reject.data?.reviewNote === '冒烟测试退回', JSON.stringify(reject.data?.reviewNote));
  check('退回的文件对外 → 403', (await probe(`/media/files/${dropId}`)).status === 403);

  // ---------------------------------------------------------------- 7
  section('7. 文件夹 + 文稿 + 公开读取');
  const colRes = await api('POST', '/api/collections', {
    token: ownerToken,
    body: { slug: `smoke-col-${Date.now().toString(36)}`, title: '冒烟文件夹', summary: '冒烟测试用' },
  });
  check('建文件夹 201', colRes.status === 201, `实际 ${colRes.status} ${colRes.text.slice(0, 160)}`);
  const colId = colRes.data?.id;
  if (colId) created.collections.push(colId);

  const docSlug = `smoke-doc-${Date.now().toString(36)}`;
  const docRes = await api('POST', '/api/documents', {
    token: ownerToken,
    body: { title: '冒烟文稿', contentMd: '# 标题\n\n正文内容。', slug: docSlug, visible: true, minLevel: 1 },
  });
  check('建文稿 201', docRes.status === 201, `实际 ${docRes.status} ${docRes.text.slice(0, 160)}`);
  const docId = docRes.data?.id;
  if (docId) created.documents.push(docId);
  check('slug 生效', docRes.data?.slug === docSlug, JSON.stringify(docRes.data?.slug));

  if (docId && colId) {
    check(
      '文稿改归属 200',
      (await api('PUT', `/api/documents/${docId}`, { token: ownerToken, body: { collectionId: colId } })).status ===
        200,
    );
  }

  check('公开文件夹列表 200', (await api('GET', '/api/public/collections')).status === 200);
  const pubDocs = await api('GET', '/api/public/documents');
  check('公开文稿列表 200', pubDocs.status === 200);
  check(
    '公开列表里能看到刚建的文稿',
    (pubDocs.data?.items ?? []).some((d) => d.slug === docSlug),
    `共 ${pubDocs.data?.items?.length ?? 0} 条`,
  );

  const pubDoc = await api('GET', `/api/public/documents/${docSlug}`);
  check('公开读单篇 200', pubDoc.status === 200, `实际 ${pubDoc.status}`);
  check(
    '正文可取到',
    String(pubDoc.data?.contentMd ?? pubDoc.data?.content_md ?? '').includes('正文内容'),
  );

  // ---------------------------------------------------------------- 8
  section('8. 文稿绑定文件 + 打包下载');
  const bind = await api('POST', `/api/documents/${docId}/files`, {
    token: ownerToken,
    body: { fileId: pngId },
  });
  check('绑定文件 201', bind.status === 201, `实际 ${bind.status} ${bind.text.slice(0, 160)}`);

  const pubFiles = await api('GET', `/api/public/documents/${docSlug}/files`);
  check('公开文件清单 200', pubFiles.status === 200);
  // 注意返回形状是 { fileId, file: {...} }，文件 id 在 fileId 上而不是 id 上
  check(
    '清单里有绑定的文件',
    (pubFiles.data?.items ?? []).some((f) => f.fileId === pngId || f.file?.id === pngId),
    `共 ${pubFiles.data?.items?.length ?? 0} 条，形状=${JSON.stringify(pubFiles.data?.items?.[0] ?? {})}`,
  );

  const zipRes = await fetch(`${BASE}/api/public/documents/${docSlug}/download`);
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  check('打包下载 200', zipRes.status === 200, `实际 ${zipRes.status}`);
  check('拿到非空 zip（PK 头）', zipBuf.length > 100 && zipBuf[0] === 0x50 && zipBuf[1] === 0x4b, `${zipBuf.length} 字节`);

  check(
    '解绑 200',
    (await api('DELETE', `/api/documents/${docId}/files/${pngId}`, { token: ownerToken })).status === 200,
  );

  // ---------------------------------------------------------------- 9
  section('9. 分享链接');
  const shareRes = await api('POST', '/api/shares', {
    token: ownerToken,
    body: { targetType: 'document', targetId: docId, expiresInHours: 1 },
  });
  check('建分享 201', shareRes.status === 201, `实际 ${shareRes.status} ${shareRes.text.slice(0, 160)}`);
  const shareToken = shareRes.data?.token;
  if (shareRes.data?.id) created.shares.push(shareRes.data.id);

  if (shareToken) {
    check('匿名读分享 200', (await api('GET', `/api/s/${shareToken}`)).status === 200);
    check('无效 token → 404', (await api('GET', '/api/s/definitely-not-a-token')).status === 404);
  }
  check(
    '会员不能分享文稿 → 403',
    (await api('POST', '/api/shares', { token: memberToken, body: { targetType: 'document', targetId: docId } }))
      .status === 403,
  );

  // ---------------------------------------------------------------- 10
  section('10. 坞主统计 + 站点文案');
  const stats = await api('GET', '/api/owner/stats', { token: ownerToken });
  check('统计 200', stats.status === 200);
  check('统计里有文件总数', typeof stats.data?.files?.total === 'number', JSON.stringify(stats.data?.files));
  check('统计里有磁盘余量', typeof stats.data?.storage?.diskFreeBytes === 'number');

  const site = await api('GET', '/api/public/site');
  check('公开站点文案 200', site.status === 200);
  check('站点名存在', typeof site.data?.site_name === 'string' && site.data.site_name.length > 0);

  // ---------------------------------------------------------------- 11
  section('11. 问卷（外发链接、免登录填答）');
  const sv = await api('POST', '/api/owner/surveys', {
    token: ownerToken,
    body: {
      title: `冒烟问卷 ${Date.now().toString(36)}`,
      descriptionMd: '这是冒烟问卷的说明。',
      questions: [
        { kind: 'single', title: '你从哪里来？', required: true, options: ['甲', '乙', '丙'] },
        { kind: 'multiple', title: '你用过哪些？', required: false, options: ['A', 'B', 'C'] },
        { kind: 'text', title: '一句话评价', required: false },
        { kind: 'rating', title: '整体满意度', required: true, maxRating: 5 },
      ],
    },
  });
  check('建问卷 201', sv.status === 201, `实际 ${sv.status} ${sv.text.slice(0, 160)}`);
  const svId = sv.data?.id;
  const svToken = sv.data?.token;
  if (svId) created.surveys.push(svId);
  check('四道题都在', sv.data?.questions?.length === 4, String(sv.data?.questions?.length));
  check('外发路径形如 /q/xxx', String(sv.data?.path ?? '').startsWith('/q/'), String(sv.data?.path));

  const pub = await getWithCookie(`/api/q/${svToken}`);
  check('匿名取问卷 200', pub.status === 200, `实际 ${pub.status}`);
  check('题目一并下发', pub.data?.questions?.length === 4);
  check('公开接口不泄露答卷统计', pub.data?.responseCount === undefined);
  check('下发了访客 cookie', Boolean(pub.vid));

  check('匿名不能管问卷 → 401', (await api('GET', '/api/owner/surveys')).status === 401);
  check(
    '会员不能管问卷 → 403',
    (await api('GET', '/api/owner/surveys', { token: memberToken })).status === 403,
  );

  const qs = pub.data?.questions ?? [];
  const q1 = qs.find((q) => q.kind === 'single');
  const q2 = qs.find((q) => q.kind === 'multiple');
  const q3 = qs.find((q) => q.kind === 'text');
  const q4 = qs.find((q) => q.kind === 'rating');

  if (q1 && q2 && q3 && q4) {
    const empty = await postWithCookie(`/api/q/${svToken}/submit`, { answers: {} }, pub.vid);
    check('缺必答 → 400', empty.status === 400, `实际 ${empty.status}`);

    const badOpt = await postWithCookie(
      `/api/q/${svToken}/submit`,
      { answers: { [q1.id]: '不存在的选项', [q4.id]: 5 } },
      pub.vid,
    );
    check('选了不存在的选项 → 400', badOpt.status === 400, `实际 ${badOpt.status}`);

    const badRate = await postWithCookie(
      `/api/q/${svToken}/submit`,
      { answers: { [q1.id]: '甲', [q4.id]: 99 } },
      pub.vid,
    );
    check('评分越界 → 400', badRate.status === 400, `实际 ${badRate.status}`);

    const good = await postWithCookie(
      `/api/q/${svToken}/submit`,
      {
        answers: {
          [q1.id]: '乙',
          [q2.id]: ['A', 'C'],
          [q3.id]: '还行',
          [q4.id]: 4,
        },
      },
      pub.vid,
    );
    check('正常提交 200', good.status === 200, `实际 ${good.status} ${good.text.slice(0, 120)}`);

    const dupSubmit = await postWithCookie(
      `/api/q/${svToken}/submit`,
      { answers: { [q1.id]: '甲', [q4.id]: 3 } },
      pub.vid,
    );
    check('同一浏览器再交 → 409', dupSubmit.status === 409, `实际 ${dupSubmit.status}`);

    const resp = await api('GET', `/api/owner/surveys/${svId}/responses`, { token: ownerToken });
    check('坞主看答卷 200', resp.status === 200);
    check('收到 1 份', resp.data?.total === 1, String(resp.data?.total));
    const answers = resp.data?.items?.[0]?.answers ?? [];
    check('作答题数 4 条', answers.length === 4, String(answers.length));
    const multi = answers.find((a) => a.questionId === q2.id)?.value;
    check('多选值落成数组', Array.isArray(multi) && multi.length === 2, JSON.stringify(multi));

    const csvRes = await fetch(`${BASE}/api/owner/surveys/${svId}/export.csv`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const csvText = await csvRes.text();
    check('导出 CSV 200', csvRes.status === 200, `实际 ${csvRes.status}`);
    check(
      'CSV 有表头 + 一行数据',
      csvText.includes('提交时间') && csvText.trim().split(/\r?\n/).length === 2,
      `${csvText.trim().split(/\r?\n/).length} 行`,
    );

    const grow = await api('PUT', `/api/owner/surveys/${svId}`, {
      token: ownerToken,
      body: {
        questions: [
          ...qs.map((q) => ({
            id: q.id,
            kind: q.kind,
            title: q.title,
            required: q.required,
            options: q.options,
            maxRating: q.maxRating,
          })),
          { kind: 'text', title: '新加的一道题' },
        ],
      },
    });
    check('有答卷后增删题目 → 409', grow.status === 409, `实际 ${grow.status}`);

    await api('PUT', `/api/owner/surveys/${svId}`, { token: ownerToken, body: { status: 'closed' } });
    const closedSubmit = await postWithCookie(
      `/api/q/${svToken}/submit`,
      { answers: { [q1.id]: '甲', [q4.id]: 3 } },
      'another-visitor',
    );
    check('关闭后提交 → 409', closedSubmit.status === 409, `实际 ${closedSubmit.status}`);

    const rotated = await api('POST', `/api/owner/surveys/${svId}/rotate`, { token: ownerToken });
    check('换令牌 200', rotated.status === 200);
    check('旧链接失效 → 404', (await api('GET', `/api/q/${svToken}`)).status === 404);
    check('新链接可用 → 200', (await api('GET', `/api/q/${rotated.data?.token}`)).status === 200);
  } else {
    check('题目结构齐全（单选/多选/填空/评分）', false, JSON.stringify(qs.map((q) => q.kind)));
  }

  check('不存在的问卷 token → 404', (await api('GET', '/api/q/definitely-not-a-token')).status === 404);

  // ---------------------------------------------------------------- 12
  section('12. 清理测试数据');
  for (const id of created.files) {
    const r = await api('DELETE', `/api/files/${id}?purge=1`, { token: ownerToken });
    if (r.status !== 200) console.log(`  ! 删文件 ${id} → ${r.status}`);
  }
  for (const id of created.documents) {
    const r = await api('DELETE', `/api/documents/${id}`, { token: ownerToken });
    if (r.status !== 200) console.log(`  ! 删文稿 ${id} → ${r.status}`);
  }
  for (const id of created.collections) {
    const r = await api('DELETE', `/api/collections/${id}`, { token: ownerToken });
    if (r.status !== 200) console.log(`  ! 删文件夹 ${id} → ${r.status}`);
  }
  for (const id of created.shares) {
    const r = await api('DELETE', `/api/shares/${id}`, { token: ownerToken });
    if (r.status !== 200) console.log(`  ! 撤分享 ${id} → ${r.status}`);
  }
  for (const id of created.members) {
    const r = await api('DELETE', `/api/owner/members/${id}`, { token: ownerToken });
    if (r.status !== 200) console.log(`  ! 删会员 ${id} → ${r.status}`);
  }
  for (const code of created.codes) {
    const r = await api('DELETE', `/api/owner/codes/${encodeURIComponent(code)}`, { token: ownerToken });
    if (r.status !== 200) console.log(`  ! 删邀请码 ${code} → ${r.status}`);
  }
  for (const id of created.surveys) {
    const r = await api('DELETE', `/api/owner/surveys/${id}`, { token: ownerToken });
    if (r.status !== 200) console.log(`  ! 删问卷 ${id} → ${r.status}`);
  }

  const leftDocs = await api('GET', '/api/documents', { token: ownerToken });
  const leftSlugs = (leftDocs.data?.items ?? []).filter((d) => String(d.slug ?? '').startsWith('smoke-doc-'));
  check('清理干净（无残留冒烟文稿）', leftSlugs.length === 0, `残留 ${leftSlugs.length} 篇`);

  const leftSurveys = await api('GET', '/api/owner/surveys', { token: ownerToken });
  const leftSv = (leftSurveys.data?.items ?? []).filter((s) => String(s.title ?? '').startsWith('冒烟问卷'));
  check('清理干净（无残留冒烟问卷）', leftSv.length === 0, `残留 ${leftSv.length} 份`);

  // ---------------------------------------------------------------- 汇总
  console.log('\n════════════════════════════════');
  console.log(`通过 ${pass} 项，失败 ${failures.length} 项`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log('全部通过。');
    process.exitCode = 0;
  }
};

main().catch((err) => {
  console.error('\n冒烟测试中断：', err);
  process.exitCode = 1;
});

import { smartBackup, importBackupData, collectStoreStats, exportFullBackup, importStoreRecords } from '../data/backup';
import { planShards, buildShardManifest, shardFileName, verifyShardManifest } from '../services/backup-shards';
import type { ShardManifest } from '../services/backup-shards';
import { showStatus, openModal, closeModal } from './common';

export async function updateBackupStatusUI(): Promise<void> {
  const el = document.getElementById('backup-status');
  if (!el) return;
  const last = localStorage.getItem('lastBackupTime');
  const stats = await collectStoreStats();
  if (last) {
    el.textContent = `上次备份: ${new Date(last).toLocaleString()} | 当前数据: ${stats.counts.questions ?? 0} 题 / ${stats.counts.tags ?? 0} 标签 / ${stats.counts.question_tags ?? 0} 关联`;
  } else {
    el.textContent = '尚未备份';
  }
}

// native 分片备份固定目录名（与 getBackupPath() 的固定名约定一致，只是从单文件变成目录）
function getShardedBackupDir(): string {
  const custom = localStorage.getItem('backupPath');
  return custom ? `${custom}/question-bank-backup` : 'question-bank-backup';
}

// 「📤 导出」带日期的目录名
function getDatedBackupDir(): string {
  const date = new Date().toISOString().slice(0, 10);
  const custom = localStorage.getItem('backupPath');
  return custom ? `${custom}/question-bank-backup-${date}` : `question-bank-backup-${date}`;
}

// 写侧分片：把整份 payload 拆成 ≤2MB 的 JSON 数组分片，逐个文件 utf8 直写。
// 整份 JSON 永不一次性驻留内存，峰值从 50MB 级降到 2MB 级，避免手机 WebView OOM 闪退。
async function writeShardedBackup(
  Filesystem: any,
  dir: string,
  payload: Record<string, unknown>,
): Promise<{ total: number; shards: number }> {
  const directory = getBackupDir();
  try {
    await Filesystem.mkdir({ path: dir, directory, recursive: true });
  } catch (e) {
    const msg = (e as any)?.message ?? String(e);
    // 仅容忍「目录已存在」（直接放过，继续往下写）；其它任何错误必须带上原始信息重新抛出，
    // 不得静默吞掉 → 否则会退化成上层笼统的 FILE_NOTCREATED 而丢失真实原因
    if (!/exist/i.test(msg)) throw new Error('无法创建备份目录：' + msg);
  }
  // pending_link_list 是数组但属于 localStorage 项，不当作 store 分片，单独作为 others 落盘
  const { pending_link_list, ...rest } = payload;
  const { arrays, others } = planShards(rest);
  if (pending_link_list !== undefined) others.push({ key: 'pending_link_list', value: pending_link_list });

  let total = 0;
  let shardCount = 0;
  for (const { store, shards } of arrays) {
    for (let i = 0; i < shards.length; i++) {
      const fileName = shardFileName(store, i);
      await Filesystem.writeFile({ path: `${dir}/${fileName}`, data: JSON.stringify(shards[i]), directory, encoding: 'utf8' });
      shardCount++;
    }
    total += shards.reduce((s, sh) => s + sh.length, 0);
  }
  const manifest = buildShardManifest(arrays, others);
  await Filesystem.writeFile({ path: `${dir}/manifest.json`, data: JSON.stringify(manifest), directory, encoding: 'utf8' });
  // others（非数组项，如 _meta / pending_link_list）键名即文件名，恢复端按 manifest.others 回填
  for (const o of others) {
    await Filesystem.writeFile({ path: `${dir}/${o.key}.json`, data: JSON.stringify(o.value), directory, encoding: 'utf8' });
  }
  return { total, shards: shardCount };
}

// 统一的全量备份写入：所有备份入口都经此产出完整自包含数据（修复 D8/FF-1），返回题目数
export async function writeFullBackup(): Promise<number> {
  const cap = (window as any).Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const data = await smartBackup();
  const count = (data.questions as unknown[]).length;
  if (isNative) {
    const Filesystem = cap?.Plugins?.Filesystem;
    // 原生环境必须真的把文件写下去；若缺 Filesystem 插件则显式失败，绝不假装成功
    if (!Filesystem) {
      throw new Error('本机缺少 Filesystem 插件，无法写入备份文件');
    }
    // 防回归：native 必须用分片目录（逐片 utf8 直写），绝不可退回一次性组装整份 JSON（峰值 50MB 级 → 手机 WebView OOM 闪退）
    const dir = getShardedBackupDir();
    const { shards } = await writeShardedBackup(Filesystem, dir, data as unknown as Record<string, unknown>);
    localStorage.setItem('lastBackupTime', new Date().toISOString());
    await updateBackupStatusUI();
    showStatus(`全量备份完成：已保存到应用外部目录 ${dir}/，共 ${count} 道题目（${shards} 片）`, 'success');
  } else {
    const jsonStr = JSON.stringify(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `question-bank-full-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem('lastBackupTime', new Date().toISOString());
    await updateBackupStatusUI();
    showStatus(`全量备份完成：已下载到浏览器，共 ${count} 道题目`, 'success');
  }
  return count;
}

export async function doSmartBackup(): Promise<void> {
  try {
    await writeFullBackup();
  } catch (e) {
    showStatus('备份失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
  }
}

export async function doFullBackup(): Promise<void> {
  try {
    await writeFullBackup();
  } catch (e) {
    showStatus('全量备份失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
  }
}

export async function restoreFromBackup(file: File): Promise<void> {
  try {
    const data = JSON.parse(await file.text()) as Record<string, unknown>;
    assertBackupHasData(data);
    const result = await importBackupData(data);
    showStatus(`恢复完成：写入 ${result.questions} 道题目、${result.tags} 个标签`, 'success');
  } catch (e) {
    showStatus('恢复失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
  }
}

export function getBackupPath(): string {
  const custom = localStorage.getItem('backupPath');
  return custom ? custom + '/question-bank-backup.json' : 'question-bank-backup.json';
}

export function getBackupDir(): string {
  // 防回归：必须是 EXTERNAL（应用专属外部目录 /storage/emulated/0/Android/data/<包名>/files）。
  // 不能退回 DOCUMENTS（公共目录，targetSdk 34 下需「所有文件访问」权限且插件不引导授权 → 写操作被系统拒绝，本次故障根因）；
  // 也不能用 DATA（/data/data 真私有，非 root 取不出文件）。
  return 'EXTERNAL';
}

export function showBackupModal(): void {
  const toggle = document.getElementById('auto-backup-toggle') as HTMLInputElement | null;
  const autoBackupEnabled = localStorage.getItem('autoBackup') === '1';
  if (toggle) toggle.checked = autoBackupEnabled;
  updateBackupStatusUI();
  const info = document.getElementById('backup-path-info');
  if (info) {
    const custom = localStorage.getItem('backupPath');
    info.innerHTML = custom ? '备份到应用外部目录 <b>' + custom + '/</b> 下' : '文件将保存在应用外部目录 <b>question-bank-backup.json</b>';
  }
  openModal('backup-modal');
}

export function closeBackupModal(): void {
  closeModal('backup-modal');
}

export function toggleAutoBackup(enabled: boolean): void {
  localStorage.setItem('autoBackup', enabled ? '1' : '0');
  if (enabled) void doAutoBackup();
}

const AUTO_BACKUP_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

// 自动备份指纹：复用 collectStoreStats 的单一来源统计（条数 + 最大时间戳），拼成字符串
async function computeAutoBackupFingerprint(): Promise<string> {
  const stats = await collectStoreStats();
  const counts = Object.keys(stats.counts).map(k => stats.counts[k]);
  return counts.join(',') + '|' + stats.maxUpdatedAt;
}

export async function doAutoBackup(): Promise<void> {
  if (localStorage.getItem('autoBackup') !== '1') return;
  const cap = (window as any).Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  if (!isNative) return;
  const Filesystem = isNative ? cap?.Plugins?.Filesystem : null;
  if (!Filesystem) return;

  // 时间门改判 lastAutoBackupAttemptTime：24 小时内无论成功失败都不再重试，避免持续失败时
  // 每次保存题目评语都重跑全量读+序列化而白烧 CPU/内存
  const lastAttempt = localStorage.getItem('lastAutoBackupAttemptTime');
  if (lastAttempt && (Date.now() - Date.parse(lastAttempt)) < AUTO_BACKUP_MIN_INTERVAL_MS) return;
  localStorage.setItem('lastAutoBackupAttemptTime', new Date().toISOString());

  // 再算指纹：数据无变化则跳过
  let fingerprint = '';
  try {
    fingerprint = await computeAutoBackupFingerprint();
  } catch (e) { console.error('自动备份指纹计算失败:', e); return; }
  const lastFp = localStorage.getItem('lastAutoBackupFingerprint');
  if (fingerprint === lastFp) return;

  try {
    const data = await smartBackup();
    // 防回归：utf8 分片直写，勿退回一次性组装整份 JSON（OOM 闪退）
    const dir = getShardedBackupDir();
    await writeShardedBackup(Filesystem, dir, data as unknown as Record<string, unknown>);
    localStorage.setItem('lastBackupTime', new Date().toISOString());
    localStorage.setItem('lastAutoBackupTime', new Date().toISOString());
    localStorage.setItem('lastAutoBackupFingerprint', fingerprint);
  } catch (e) {
    console.error('自动备份失败:', e);
    maybeShowAutoBackupError();
  }
}

// 自动备份失败时给一次用户可见、且 24 小时内限频一次的提示，避免静默坏掉
function maybeShowAutoBackupError(): void {
  const lastShown = localStorage.getItem('lastAutoBackupErrorShownAt');
  if (lastShown && (Date.now() - Date.parse(lastShown)) < AUTO_BACKUP_MIN_INTERVAL_MS) return;
  localStorage.setItem('lastAutoBackupErrorShownAt', new Date().toISOString());
  showStatus('自动备份失败，请到「☁️ 备份」手动备份一次', 'error');
}

// ⚠️ 回调必须是块体且不返回值：localforage 的 iterate 一旦回调返回非 undefined 就立即终止迭代；
// 写成 `(v) => arr.push(v)` 会返回新长度 → 每个 store 只导出第一条记录（FF-1, 2026-09-12）。
export async function buildBackupData(): Promise<{ questions: any[]; tags: any[]; question_tags: any[]; papers: any[]; paper_questions: any[]; similar_question_links: any[] }> {
  const { dbQuestions, dbTags, dbQuestionTags, dbPapers, dbPaperQuestions, dbSimilarQuestionLinks } = await import('../data/stores');
  const data: any = { questions: [], tags: [], question_tags: [], papers: [], paper_questions: [], similar_question_links: [] };
  await dbQuestions.iterate((v: any) => { data.questions.push(v); });
  await dbTags.iterate((v: any) => { data.tags.push(v); });
  await dbQuestionTags.iterate((v: any) => { data.question_tags.push(v); });
  await dbPapers.iterate((v: any) => { data.papers.push(v); });
  await dbPaperQuestions.iterate((v: any) => { data.paper_questions.push(v); });
  await dbSimilarQuestionLinks.iterate((v: any) => { data.similar_question_links.push(v); });
  return data;
}

export async function saveBackupToDevice(): Promise<void> {
  try {
    await writeFullBackup();
  } catch (e) {
    showStatus('备份失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
  }
}

// 「📤 导出」按钮的同名接管实现（原在 public/db.js）。用 exportFullBackup() 取全量 13 个 store
// 数据，文件名带日期以区别于固定名的备份文件。native 无 Filesystem 时显式 throw，绝不假装成功。
export async function exportAllData(): Promise<void> {
  try {
    const cap = (window as any).Capacitor;
    const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
    const data = await exportFullBackup();
    const count = (data.questions as unknown[]).length;
    const fileName = `question-bank-backup-${new Date().toISOString().slice(0, 10)}.json`;
    if (isNative) {
      const Filesystem = cap?.Plugins?.Filesystem;
      // 原生环境必须真的写下去；缺 Filesystem 则显式失败，绝不允许落到 Web 下载分支假装成功
      if (!Filesystem) {
        throw new Error('本机缺少 Filesystem 插件，无法导出带日期的备份文件');
      }
      // 防回归：native 分片目录（逐片 utf8 直写），勿退回一次性 JSON（OOM 闪退）
      const dir = getDatedBackupDir();
      const { shards } = await writeShardedBackup(Filesystem, dir, data as unknown as Record<string, unknown>);
      showStatus(`已导出 ${count} 道题目到应用外部目录 ${dir}/（共 ${shards} 片）`, 'success');
    } else {
      const jsonStr = JSON.stringify(data);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      showStatus(`已导出 ${count} 道题目，文件已下载: ${fileName}`, 'success');
    }
  } catch (e) {
    showStatus('导出失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
  }
}

// 恢复前的防线：确认文件确实含可恢复数据。仅当 questions 与 tags 两者都为空（或都不是数组）
// 时才拒绝——"只有标签没有题目"等合法备份应放行，交由调用方的 confirm 决定。返回题目数。
export function assertBackupHasData(data: any): number {
  if (!data || typeof data !== 'object') {
    throw new Error('这不是数据备份文件（缺少 questions/tags），无法导入');
  }
  const qEmpty = !Array.isArray(data.questions) || data.questions.length === 0;
  const tEmpty = !Array.isArray(data.tags) || data.tags.length === 0;
  if (qEmpty && tEmpty) {
    throw new Error('这不是数据备份文件（缺少 questions/tags），无法导入');
  }
  return Array.isArray(data.questions) ? data.questions.length : 0;
}

// 读侧分片恢复：读 manifest → verifyShardManifest 校验 → 逐 store 逐片 readFile + importStoreRecords
// → 每片处理完显式释放引用（避免 50MB 级对象图累积，OOM 闪退根因）→ 处理 others（pending_link_list 等）。
// 校验只信 manifest 的 shards/count 计数；单条记录本身超限是预期的降级（单独成片），不以单片字节数判失败。
async function restoreFromSharded(
  Filesystem: any,
  dir: string,
  directory: string,
  manifest: ShardManifest,
): Promise<{ records: number; shards: number }> {
  const actual: { store: string; shardCount: number; recordCount: number }[] = [];
  let records = 0;
  let shards = 0;
  for (const s of manifest.stores) {
    let recordCount = 0;
    let shardCount = 0;
    for (let i = 0; i < s.shards; i++) {
      const res = await Filesystem.readFile({ path: `${dir}/${shardFileName(s.name, i)}`, directory, encoding: 'utf8' });
      const shard = JSON.parse(res.data as string) as unknown[];
      if (!Array.isArray(shard)) throw new Error(`分片不是数组：${shardFileName(s.name, i)}`);
      await importStoreRecords(s.name, shard);
      recordCount += shard.length;
      shardCount++;
      // 显式释放该片引用，避免逐片累积
      shard.length = 0;
    }
    records += recordCount;
    shards += shardCount;
    actual.push({ store: s.name, shardCount, recordCount });
  }
  // 校验不通过（片数/记录数不符）明确报错，绝不允许出现「恢复成功 0 题」
  const errors = verifyShardManifest(manifest, actual);
  if (errors.length > 0) {
    throw new Error('备份完整性校验失败：' + errors.join('；') + '（已恢复部分数据，请重新导出备份）');
  }
  // others（非数组项）：pending_link_list 写回 localStorage，其余（如 _meta）忽略，与 importBackupData 一致
  for (const key of manifest.others) {
    try {
      const res = await Filesystem.readFile({ path: `${dir}/${key}.json`, directory, encoding: 'utf8' });
      const value = JSON.parse(res.data as string);
      if (key === 'pending_link_list') localStorage.setItem('pendingLinkList', JSON.stringify(value));
    } catch {
      // 个别 other 文件缺失不阻断整体恢复
    }
  }
  return { records, shards };
}

// 探测可恢复的分片备份：按优先级依次尝试
//   1) 新位置 EXTERNAL 的固定名目录 question-bank-backup
//   2) 新位置 EXTERNAL 下所有带日期目录 question-bank-backup-YYYY-MM-DD（取日期最新）
//   3) 旧位置 DOCUMENTS（曾在已授「所有文件访问」权限设备上生成的备份）的固定名与带日期目录
// 返回首个含合法 sharded_v1 manifest 的候选；都找不到返回 null。
// 旧位置 DOCUMENTS 必须保留探测：手机等已授权设备上的历史备份就在公共 Documents 下，
// 切到 EXTERNAL 后若不回退探测旧位置，这些旧备份会彻底找不到。
async function findShardedBackup(
  Filesystem: any,
): Promise<{ dir: string; directory: string; manifest: ShardManifest } | null> {
  const directories = ['EXTERNAL', 'DOCUMENTS'];
  for (const directory of directories) {
    const candidates: string[] = [getShardedBackupDir()];
    // 枚举该目录下所有带日期的子目录，取名称里日期最新的（YYYY-MM-DD 字典序即时间序）
    try {
      const listing = await Filesystem.readdir({ path: '', directory });
      const dated = (listing.files ?? [])
        .map((f: any) => (typeof f === 'string' ? f : f.name))
        .filter((name: string) => /^question-bank-backup-\d{4}-\d{2}-\d{2}$/.test(name))
        .sort()
        .reverse();
      candidates.push(...dated);
    } catch {
      // 该目录不可列（如目录不存在 / 插件不支持）则跳过枚举，仅试固定名
    }
    for (const dir of candidates) {
      try {
        const res = await Filesystem.readFile({ path: `${dir}/manifest.json`, directory, encoding: 'utf8' });
        const parsed = JSON.parse(res.data as string);
        if (parsed && parsed.format === 'sharded_v1') {
          return { dir, directory, manifest: parsed as ShardManifest };
        }
      } catch {
        // 该候选无合法 manifest，试下一个
      }
    }
  }
  return null;
}

export async function loadBackupFromDevice(): Promise<void> {
  const cap = (window as any).Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const Filesystem = isNative ? cap?.Plugins?.Filesystem : null;
  const existingQS = await (window as any).dbGetAllQuestions?.() ?? [];
  const existingCount = existingQS.length;
  if (existingCount > 0 && !confirm('当前已有 ' + existingCount + ' 道题目，加载备份将覆盖同名数据。\n\n确定要继续吗？')) return;
  try {
    if (isNative && Filesystem) {
      const found = await findShardedBackup(Filesystem);
      if (found) {
        const { dir, directory, manifest } = found;
        const qStore = manifest.stores.find((s) => s.name === 'questions');
        const backupCount = qStore ? qStore.count : 0;
        // 把最终实际使用的目录名与位置显示给用户，避免「我到底恢复了哪一份」的模糊
        const where = directory === 'DOCUMENTS' ? '公共 Documents 目录' : '应用外部目录';
        if (!confirm(`分片备份（${dir}，位于${where}）包含 ${backupCount} 道题目，确定导入？`)) return;
        const result = await restoreFromSharded(Filesystem, dir, directory, manifest);
        await (window as any).refreshAll?.();
        showStatus(`备份恢复成功: ${backupCount} 题 / ${result.shards} 片 / ${manifest.stores.length} 个 store（来自 ${dir}，${where}）`, 'success');
      } else {
        // 旧版单文件兼容路径（历史备份必须仍可恢复）：同时覆盖新位置 EXTERNAL 与旧位置 DOCUMENTS
        const singleCandidates: Array<{ path: string; directory: string }> = [
          { path: 'question-bank-backup.json', directory: getBackupDir() },
          { path: 'question-bank-backup.json', directory: 'DOCUMENTS' },
        ];
        let loaded: { data: any; directory: string } | null = null;
        for (const c of singleCandidates) {
          try {
            const res = await Filesystem.readFile({ path: c.path, directory: c.directory, encoding: 'utf8' });
            loaded = { data: JSON.parse(res.data as string), directory: c.directory };
            break;
          } catch {
            // 该位置无旧版单文件，试下一个
          }
        }
        if (!loaded) {
          // 明确报错并说明查找过哪些位置，杜绝「恢复成功 0 题」式静默
          throw new Error('未找到可恢复的备份：已查找 应用外部目录(EXTERNAL) 与 公共 Documents 目录(DOCUMENTS) 下的 question-bank-backup 分片目录及旧版单文件');
        }
        const data = loaded.data;
        const backupCount = assertBackupHasData(data);
        const where = loaded.directory === 'DOCUMENTS' ? '公共 Documents 目录' : '应用外部目录';
        if (!confirm('备份包含 ' + backupCount + ' 道题目，确定导入？')) return;
        await importBackupData(data);
        await (window as any).refreshAll?.();
        showStatus('备份恢复成功: ' + backupCount + ' 题（来自旧版单文件，' + where + '）', 'success');
      }
    } else {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
        const data = JSON.parse(await file.text());
        const backupCount = assertBackupHasData(data);
        if (!confirm('备份包含 ' + backupCount + ' 道题目，确定导入？')) return;
        await importBackupData(data); await (window as any).refreshAll?.();
        showStatus('备份恢复成功: ' + backupCount + ' 题', 'success');
      };
      input.click();
    }
  } catch (e) { showStatus('恢复失败: ' + (e instanceof Error ? e.message : String(e)), 'error'); }
}

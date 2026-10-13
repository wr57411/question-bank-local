// 键必须用「标签名」而非类别 id：类别 id 随机生成、跨设备不一致，标签名才稳定。
// 类别名必须与 tag-categories.ts 的 DEFAULT_TAG_CATEGORIES 逐字一致（由网页审校工具导出的 JSON 生成）。
// 数据来源：/Volumes/zhitai/download zt/tag-classification.json（王先生 2026-10-13 人工审校版，90 条）。

const KNOWLEDGE_MODEL = [
   'f=kv', '临界情况', '传送带', '传送带分段加速和减速', '传送带和滑轮', '做功', '光学', '关联运动', '力学', '加速度', '动力学临界问题',
   '动态平衡', '动摩擦因数处处相同', '动滑轮模型', '动滑轮连接体', '动能定理', '动量守恒定律', '动量定理', '单摆', '单摆应用',
   '单摆结合圆周运动', '单摆结合能量', '受力分析', '变力做功', '圆周运动', '圆周运动摩擦力', '圆周运动立体临界滑动', '圆周运动综合', '圆锥摆模型',
   '多用表电学实验', '平抛运动', '引力', '弹性碰撞', '弹簧加摩擦力连接体', '弹簧碰撞', '情境题', '摩擦力', '摩擦角', '整体法分析加速',
   '整体法隔离法', '斜抛运动', '方向任意', '曲面运动结合动能定理', '最大动能', '机械波多解', '机械能守恒', '板块模型', '板块模型多过程',
   '板块模型推上面', '水平圆周运动', '活动杆', '流体模型', '点电荷电场', '牛顿定律', '电场综合', '电学实验', '电磁感应', '直线运动',
   '等时圆', '简谐振动', '简谐运动', '简谐运动水平模型', '能量运动综合', '质量为零的碰撞', '辅助角公式', '运动合成分解', '运动合成分解连接体',
   '运动实验', '连接体整体法', '追及问题', '隔离法放一起',
];

const ERROR_PRONE = [
   '易错', '易错仔细读题', '易错综合', '易错题',
];

const DIFFICULTY = [
   '困难', '较难', '难度较大',
];

const OTHER_TRAITS = [
   '典型题', '图像', '多过程分析', '巧妙解法', '来回不对称', '求导', '求范围', '立体题', '较新',
];

const TYPICAL_METHOD = [
   '归纳法', '微元法', '逆向思维',
];

export const TAG_CATEGORY_GUESS: Record<string, string> = Object.fromEntries([
  ...KNOWLEDGE_MODEL.map((n) => [n, '知识点/模型'] as const),
  ...ERROR_PRONE.map((n) => [n, '易错题'] as const),
  ...DIFFICULTY.map((n) => [n, '难度'] as const),
  ...OTHER_TRAITS.map((n) => [n, '其他特征'] as const),
  ...TYPICAL_METHOD.map((n) => [n, '典型方法'] as const),
]);

// 未命中映射时的关键词退化规则（按顺序命中即返回），类别名已对齐王先生的七类：
//   含 易错/错/误/粗心/漏/混淆/不对称 → 易错题
//   含 难/易/简单/复杂/基础/拔高/压轴/入门/较新 → 难度
//   含 题/情境/情景/图像/多过程/立体 → 情境
//   其余 → 知识点/模型
export function guessCategoryForTag(tagName: string): string | null {
  const name = (tagName || '').trim();
  if (!name) return null;
  const mapped = TAG_CATEGORY_GUESS[name];
  if (mapped) return mapped;
  if (/易错|错|误|粗心|漏|混淆|不对称/.test(name)) return '易错题';
  if (/难|易|简单|复杂|基础|拔高|压轴|入门|较新/.test(name)) return '难度';
  if (/题|情境|情景|图像|多过程|立体/.test(name)) return '情境';
  return '知识点/模型';
}

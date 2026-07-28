import { dbPdfBooks, dbPdfChapters, dbPdfTopics, dbPdfDocs, dbPdfDocTags, dbPdfCategories, generateId, nowIso } from './stores';
import type { PdfBook, PdfChapter, PdfTopic, PdfDoc, PdfCategory } from '../types';

export async function dbGetAllPdfBooks(): Promise<PdfBook[]> {
  const books: PdfBook[] = [];
  await dbPdfBooks.iterate((v: unknown) => {
    const b = v as PdfBook;
    if (b && !b.deleted_at) books.push(b);
  });
  return books;
}

export async function dbCreatePdfBook(name: string): Promise<PdfBook> {
  const book: PdfBook = { id: generateId(), name, created_at: nowIso() };
  await dbPdfBooks.setItem(book.id, book);
  return book;
}

export async function dbUpdatePdfBook(id: string, name: string): Promise<void> {
  const book = await dbPdfBooks.getItem(id) as PdfBook | null;
  if (book) {
    book.name = name;
    book.updated_at = nowIso();
    await dbPdfBooks.setItem(id, book);
  }
}

export async function dbDeletePdfBook(id: string): Promise<void> {
  const book = await dbPdfBooks.getItem(id) as PdfBook | null;
  if (book) {
    book.deleted_at = nowIso();
    await dbPdfBooks.setItem(id, book);
  }
}

export async function dbGetAllPdfChapters(): Promise<PdfChapter[]> {
  const chapters: PdfChapter[] = [];
  await dbPdfChapters.iterate((v: unknown) => {
    const c = v as PdfChapter;
    if (c && !c.deleted_at) chapters.push(c);
  });
  return chapters.sort((a, b) => a.sort_order - b.sort_order);
}

export async function dbCreatePdfChapter(bookId: string, name: string, parentId?: string, sortOrder?: number): Promise<PdfChapter> {
  const chapter: PdfChapter = { id: generateId(), book_id: bookId, parent_id: parentId, name, sort_order: sortOrder || 0, created_at: nowIso() };
  await dbPdfChapters.setItem(chapter.id, chapter);
  return chapter;
}

export async function dbUpdatePdfChapter(id: string, data: Partial<Pick<PdfChapter, 'name' | 'parent_id' | 'sort_order'>>): Promise<void> {
  const ch = await dbPdfChapters.getItem(id) as PdfChapter | null;
  if (ch) {
    Object.assign(ch, data, { updated_at: nowIso() });
    await dbPdfChapters.setItem(id, ch);
  }
}

export async function dbDeletePdfChapter(id: string): Promise<void> {
  const ch = await dbPdfChapters.getItem(id) as PdfChapter | null;
  if (ch) {
    ch.deleted_at = nowIso();
    await dbPdfChapters.setItem(id, ch);
  }
}

export async function dbGetAllPdfTopics(): Promise<PdfTopic[]> {
  const topics: PdfTopic[] = [];
  await dbPdfTopics.iterate((v: unknown) => {
    const t = v as PdfTopic;
    if (t && !t.deleted_at) topics.push(t);
  });
  return topics;
}

export async function dbCreatePdfTopic(name: string, parentId?: string, sortOrder?: number): Promise<PdfTopic> {
  const topic: PdfTopic = { id: generateId(), parent_id: parentId || undefined, name, sort_order: sortOrder || 0, created_at: nowIso() };
  await dbPdfTopics.setItem(topic.id, topic);
  return topic;
}

export async function dbUpdatePdfTopic(id: string, data: Partial<Pick<PdfTopic, 'name' | 'parent_id' | 'sort_order'>>): Promise<void> {
  const topic = await dbPdfTopics.getItem(id) as PdfTopic | null;
  if (topic) {
    Object.assign(topic, data, { updated_at: nowIso() });
    await dbPdfTopics.setItem(id, topic);
  }
}

export async function dbDeletePdfTopic(id: string): Promise<void> {
  const topic = await dbPdfTopics.getItem(id) as PdfTopic | null;
  if (topic) {
    topic.deleted_at = nowIso();
    await dbPdfTopics.setItem(id, topic);
  }
}

export async function dbGetAllPdfDocs(): Promise<PdfDoc[]> {
  const docs: PdfDoc[] = [];
  await dbPdfDocs.iterate((v: unknown) => {
    const d = v as PdfDoc;
    if (d && !d.deleted_at) docs.push(d);
  });
  return docs;
}

export async function dbAddPdfDoc(doc: PdfDoc): Promise<void> {
  await dbPdfDocs.setItem(doc.id, doc);
}

export async function dbUpdatePdfDoc(id: string, data: Partial<PdfDoc>): Promise<void> {
  const doc = await dbPdfDocs.getItem(id) as PdfDoc | null;
  if (doc) {
    Object.assign(doc, data, { updated_at: nowIso() });
    await dbPdfDocs.setItem(id, doc);
  }
}

export async function dbDeletePdfDoc(id: string): Promise<void> {
  const doc = await dbPdfDocs.getItem(id) as PdfDoc | null;
  if (doc) {
    doc.deleted_at = nowIso();
    await dbPdfDocs.setItem(id, doc);
  }
}

export async function dbSetPdfDocTags(pdfId: string, tagIds: string[]): Promise<void> {
  await dbPdfDocTags.removeItem(pdfId);
  if (tagIds.length) {
    await dbPdfDocTags.setItem(pdfId, tagIds);
  }
  const doc = await dbPdfDocs.getItem(pdfId) as PdfDoc | null;
  if (doc) {
    doc.tag_ids = tagIds;
    await dbPdfDocs.setItem(pdfId, doc);
  }
}

export async function dbGetPdfDocTags(pdfId: string): Promise<string[]> {
  return (await dbPdfDocTags.getItem(pdfId) as string[] | null) || [];
}

export async function dbGetAllPdfCategories(): Promise<PdfCategory[]> {
  const cats: PdfCategory[] = [];
  await dbPdfCategories.iterate((v: unknown) => {
    const c = v as PdfCategory;
    if (c && !c.deleted_at) cats.push(c);
  });
  return cats.sort((a, b) => a.sort_order - b.sort_order);
}

export async function dbCreatePdfCategory(name: string, parentId: string | null, level: number, sortOrder: number): Promise<PdfCategory> {
  const cat: PdfCategory = { id: generateId(), parent_id: parentId || undefined, name, level, sort_order: sortOrder, created_at: nowIso() };
  await dbPdfCategories.setItem(cat.id, cat);
  return cat;
}

export async function dbUpdatePdfCategory(id: string, data: Partial<Pick<PdfCategory, 'name' | 'parent_id' | 'sort_order' | 'level'>>): Promise<void> {
  const cat = await dbPdfCategories.getItem(id) as PdfCategory | null;
  if (cat) {
    Object.assign(cat, data, { updated_at: nowIso() });
    await dbPdfCategories.setItem(id, cat);
  }
}

export async function dbDeletePdfCategory(id: string): Promise<void> {
  const cat = await dbPdfCategories.getItem(id) as PdfCategory | null;
  if (cat) {
    cat.deleted_at = nowIso();
    await dbPdfCategories.setItem(id, cat);
  }
}

const TEXTBOOK_STRUCTURE: { name: string; level: number; children?: { name: string; level: number; children?: { name: string; level: number }[] }[] }[] = [
  {
    name: '必修一', level: 0,
    children: [
      { name: '第一章 运动的描述', level: 1, children: [
        { name: '1. 质点 参考系', level: 2 },
        { name: '2. 时间 位移', level: 2 },
        { name: '3. 速度', level: 2 },
        { name: '4. 加速度', level: 2 },
      ]},
      { name: '第二章 匀变速直线运动的研究', level: 1, children: [
        { name: '1. 实验：探究小车速度随时间变化的规律', level: 2 },
        { name: '2. 匀变速直线运动的速度与时间的关系', level: 2 },
        { name: '3. 匀变速直线运动的位移与时间的关系', level: 2 },
        { name: '4. 自由落体运动', level: 2 },
      ]},
      { name: '第三章 相互作用——力', level: 1, children: [
        { name: '1. 重力与弹力', level: 2 },
        { name: '2. 摩擦力', level: 2 },
        { name: '3. 牛顿第三定律', level: 2 },
        { name: '4. 力的合成和分解', level: 2 },
        { name: '5. 共点力的平衡', level: 2 },
      ]},
      { name: '第四章 运动和力的关系', level: 1, children: [
        { name: '1. 牛顿第一定律', level: 2 },
        { name: '2. 实验：探究加速度与力、质量的关系', level: 2 },
        { name: '3. 牛顿第二定律', level: 2 },
        { name: '4. 力学单位制', level: 2 },
        { name: '5. 牛顿运动定律的应用', level: 2 },
        { name: '6. 超重和失重', level: 2 },
      ]},
    ]
  },
  {
    name: '必修二', level: 0,
    children: [
      { name: '第五章 抛体运动', level: 1, children: [
        { name: '1. 曲线运动', level: 2 },
        { name: '2. 运动的合成与分解', level: 2 },
        { name: '3. 实验：探究平抛运动的特点', level: 2 },
        { name: '4. 抛体运动的规律', level: 2 },
      ]},
      { name: '第六章 圆周运动', level: 1, children: [
        { name: '1. 圆周运动', level: 2 },
        { name: '2. 向心加速度', level: 2 },
        { name: '3. 向心力', level: 2 },
        { name: '4. 生活中的圆周运动', level: 2 },
      ]},
      { name: '第七章 万有引力与宇宙航行', level: 1, children: [
        { name: '1. 行星的运动', level: 2 },
        { name: '2. 万有引力定律', level: 2 },
        { name: '3. 万有引力理论的成就', level: 2 },
        { name: '4. 宇宙航行', level: 2 },
        { name: '5. 相对论时空观与牛顿力学的局限性', level: 2 },
      ]},
      { name: '第八章 机械能守恒定律', level: 1, children: [
        { name: '1. 功与功率', level: 2 },
        { name: '2. 重力势能', level: 2 },
        { name: '3. 动能和动能定理', level: 2 },
        { name: '4. 机械能守恒定律', level: 2 },
        { name: '5. 实验：验证机械能守恒定律', level: 2 },
      ]},
    ]
  },
  {
    name: '必修三', level: 0,
    children: [
      { name: '第九章 静电场及其应用', level: 1, children: [
        { name: '1. 电荷', level: 2 },
        { name: '2. 库仑定律', level: 2 },
        { name: '3. 电场 电场强度', level: 2 },
        { name: '4. 静电的防止与利用', level: 2 },
      ]},
      { name: '第十章 静电场中的能量', level: 1, children: [
        { name: '1. 电势能和电势', level: 2 },
        { name: '2. 电势差', level: 2 },
        { name: '3. 电势差与电场强度的关系', level: 2 },
        { name: '4. 电容器的电容', level: 2 },
        { name: '5. 带电粒子在电场中的运动', level: 2 },
      ]},
      { name: '第十一章 电路及其应用', level: 1, children: [
        { name: '1. 电源和电流', level: 2 },
        { name: '2. 导体的电阻', level: 2 },
        { name: '3. 实验：导体电阻率的测量', level: 2 },
        { name: '4. 串联电路和并联电路', level: 2 },
      ]},
      { name: '第十二章 电能 能量守恒定律', level: 1, children: [
        { name: '1. 电路中的能量转化', level: 2 },
        { name: '2. 闭合电路的欧姆定律', level: 2 },
        { name: '3. 实验：电池电动势和内阻的测量', level: 2 },
        { name: '4. 能源与可持续发展', level: 2 },
      ]},
      { name: '第十三章 电磁感应与电磁波初步', level: 1, children: [
        { name: '1. 磁场 磁感线', level: 2 },
        { name: '2. 磁感应强度 磁通量', level: 2 },
        { name: '3. 电磁感应现象及其应用', level: 2 },
        { name: '4. 电磁波', level: 2 },
      ]},
    ]
  },
  {
    name: '选择性必修一', level: 0,
    children: [
      { name: '第一章 动量守恒定律', level: 1, children: [
        { name: '1. 动量', level: 2 },
        { name: '2. 动量定理', level: 2 },
        { name: '3. 动量守恒定律', level: 2 },
        { name: '4. 实验：验证动量守恒定律', level: 2 },
        { name: '5. 弹性碰撞和非弹性碰撞', level: 2 },
        { name: '6. 反冲现象 火箭', level: 2 },
      ]},
      { name: '第二章 机械振动', level: 1, children: [
        { name: '1. 简谐运动', level: 2 },
        { name: '2. 简谐运动的描述', level: 2 },
        { name: '3. 简谐运动的回复力和能量', level: 2 },
        { name: '4. 单摆', level: 2 },
        { name: '5. 外力作用下的振动', level: 2 },
      ]},
      { name: '第三章 机械波', level: 1, children: [
        { name: '1. 波的形成', level: 2 },
        { name: '2. 波的描述', level: 2 },
        { name: '3. 波的反射、折射和衍射', level: 2 },
        { name: '4. 波的干涉', level: 2 },
        { name: '5. 多普勒效应', level: 2 },
      ]},
      { name: '第四章 光', level: 1, children: [
        { name: '1. 光的折射', level: 2 },
        { name: '2. 全反射', level: 2 },
        { name: '3. 光的干涉', level: 2 },
        { name: '4. 实验：用双缝干涉测量光的波长', level: 2 },
        { name: '5. 光的衍射', level: 2 },
        { name: '6. 光的偏振 激光', level: 2 },
      ]},
    ]
  },
  {
    name: '选择性必修二', level: 0,
    children: [
      { name: '第五章 传感器', level: 1, children: [
        { name: '1. 认识传感器', level: 2 },
        { name: '2. 常见传感器的工作原理及应用', level: 2 },
        { name: '3. 利用传感器制作简单的自动控制装置', level: 2 },
      ]},
      { name: '第六章 电磁场与电磁波', level: 1, children: [
        { name: '1. 磁场对运动电荷的作用力', level: 2 },
        { name: '2. 磁场对运动电荷的作用力', level: 2 },
        { name: '3. 带电粒子在匀强磁场中的运动', level: 2 },
        { name: '4. 质谱仪与回旋加速器', level: 2 },
      ]},
      { name: '第七章 电磁感应', level: 1, children: [
        { name: '1. 楞次定律', level: 2 },
        { name: '2. 法拉第电磁感应定律', level: 2 },
        { name: '3. 电磁感应现象的两类情况', level: 2 },
        { name: '4. 互感和自感', level: 2 },
        { name: '5. 涡流 电磁阻尼和电磁驱动', level: 2 },
      ]},
      { name: '第八章 交变电流', level: 1, children: [
        { name: '1. 交变电流', level: 2 },
        { name: '2. 描述交变电流的物理量', level: 2 },
        { name: '3. 变压器', level: 2 },
        { name: '4. 电能的输送', level: 2 },
      ]},
    ]
  },
  {
    name: '选择性必修三', level: 0,
    children: [
      { name: '第九章 固体、液体和气体', level: 1, children: [
        { name: '1. 固体', level: 2 },
        { name: '2. 液体', level: 2 },
        { name: '3. 饱和汽 未饱和汽', level: 2 },
        { name: '4. 物态变化中的能量交换', level: 2 },
      ]},
      { name: '第十章 热力学定律', level: 1, children: [
        { name: '1. 功和内能', level: 2 },
        { name: '2. 热和内能', level: 2 },
        { name: '3. 热力学第一定律 能量守恒定律', level: 2 },
        { name: '4. 热力学第二定律', level: 2 },
        { name: '5. 能源与可持续发展', level: 2 },
      ]},
      { name: '第十一章 气体定律', level: 1, children: [
        { name: '1. 理想气体的状态方程', level: 2 },
        { name: '2. 气体的等温变化', level: 2 },
        { name: '3. 气体的等压变化和等容变化', level: 2 },
      ]},
      { name: '第十二章 原子结构与原子核', level: 1, children: [
        { name: '1. 原子核式结构模型', level: 2 },
        { name: '2. 氢原子光谱 玻尔的原子模型', level: 2 },
        { name: '3. 天然放射现象 衰变', level: 2 },
        { name: '4. 核反应 核能', level: 2 },
        { name: '5. 结合能 质量亏损', level: 2 },
        { name: '6. 裂变和聚变', level: 2 },
      ]},
    ]
  },
];

export async function ensureTextbookStructure(): Promise<void> {
  const existing = await dbGetAllPdfCategories();
  if (existing.length > 0) return;

  for (let bi = 0; bi < TEXTBOOK_STRUCTURE.length; bi++) {
    const book = TEXTBOOK_STRUCTURE[bi];
    const bookCat = await dbCreatePdfCategory(book.name, null, 0, bi);
    if (book.children) {
      for (let ci = 0; ci < book.children.length; ci++) {
        const chapter = book.children[ci];
        const chCat = await dbCreatePdfCategory(chapter.name, bookCat.id, 1, ci);
        if (chapter.children) {
          for (let si = 0; si < chapter.children.length; si++) {
            const section = chapter.children[si];
            await dbCreatePdfCategory(section.name, chCat.id, 2, si);
          }
        }
      }
    }
  }
}

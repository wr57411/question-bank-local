import { wikiGetAllPages } from '../data/wiki';
import { simpleSimilarity } from '../services/wiki-entity';
import type { WikiPage } from '../types';

// ===== 诊断题集 =====
// 用于验证 Wiki 知识库的完整性和准确性

export interface DiagnosticQuestion {
  id: string;
  question: string;
  expected_concepts: string[];
  difficulty: 'basic' | 'intermediate' | 'advanced';
}

export const DIAGNOSTIC_QUESTIONS: DiagnosticQuestion[] = [
  { id: 'dq1', question: '什么是牛顿第二定律？', expected_concepts: ['牛顿第二定律'], difficulty: 'basic' },
  { id: 'dq2', question: '动能定理的内容是什么？', expected_concepts: ['动能定理'], difficulty: 'basic' },
  { id: 'dq3', question: '什么是机械能守恒定律？', expected_concepts: ['机械能守恒定律'], difficulty: 'basic' },
  { id: 'dq4', question: '什么是电磁感应现象？', expected_concepts: ['电磁感应'], difficulty: 'basic' },
  { id: 'dq5', question: '单摆的周期公式是什么？', expected_concepts: ['单摆'], difficulty: 'intermediate' },
  { id: 'dq6', question: '什么是动量守恒定律？', expected_concepts: ['动量守恒定律'], difficulty: 'basic' },
  { id: 'dq7', question: '什么是圆周运动？向心力来源？', expected_concepts: ['圆周运动'], difficulty: 'intermediate' },
  { id: 'dq8', question: '什么是简谐振动？', expected_concepts: ['简谐振动'], difficulty: 'intermediate' },
  { id: 'dq9', question: '什么是楞次定律？', expected_concepts: ['楞次定律'], difficulty: 'intermediate' },
  { id: 'dq10', question: '什么是板块模型？', expected_concepts: ['板块模型'], difficulty: 'advanced' },
  { id: 'dq11', question: '什么是运动的合成与分解？', expected_concepts: ['运动合成分解'], difficulty: 'intermediate' },
  { id: 'dq12', question: '什么是动态平衡问题？', expected_concepts: ['动态平衡'], difficulty: 'advanced' },
  { id: 'dq13', question: '什么是摩擦角？', expected_concepts: ['摩擦角'], difficulty: 'advanced' },
  { id: 'dq14', question: '什么是追及问题？', expected_concepts: ['追及问题'], difficulty: 'intermediate' },
  { id: 'dq15', question: '什么是弹性碰撞？', expected_concepts: ['弹性碰撞'], difficulty: 'intermediate' },
];

// ===== 诊断结果 =====

export interface DiagnosticResult {
  total: number;
  covered: number;
  gaps: DiagnosticGap[];
  coverage_pct: number;
}

export interface DiagnosticGap {
  question_id: string;
  question: string;
  missing_concepts: string[];
  difficulty: string;
}

// ===== 运行诊断 =====

function normalize(s: string): string {
  return s.toLowerCase().replace(/[·\.\s]/g, '');
}

function isConceptCovered(concept: string, pages: WikiPage[]): boolean {
  const nc = normalize(concept);
  for (const p of pages) {
    if (normalize(p.canonical_title) === nc) return true;
    if (normalize(p.title) === nc) return true;
    for (const alias of p.aliases) {
      if (normalize(alias) === nc) return true;
    }
    if (simpleSimilarity(concept, p.canonical_title) >= 0.95) return true;
    if (simpleSimilarity(concept, p.title) >= 0.95) return true;
  }
  return false;
}

export async function runDiagnostic(): Promise<DiagnosticResult> {
  const pages = await wikiGetAllPages();
  const gaps: DiagnosticGap[] = [];
  let covered = 0;

  for (const dq of DIAGNOSTIC_QUESTIONS) {
    const missing: string[] = [];
    for (const concept of dq.expected_concepts) {
      if (!isConceptCovered(concept, pages)) missing.push(concept);
    }
    if (missing.length) {
      gaps.push({ question_id: dq.id, question: dq.question, missing_concepts: missing, difficulty: dq.difficulty });
    } else {
      covered++;
    }
  }

  return {
    total: DIAGNOSTIC_QUESTIONS.length,
    covered,
    gaps,
    coverage_pct: Math.round((covered / DIAGNOSTIC_QUESTIONS.length) * 100),
  };
}

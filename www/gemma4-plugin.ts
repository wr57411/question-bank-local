import { registerPlugin } from '@capacitor/core';

export interface QuestionAnalysis {
  tags: string[];
  difficulty: number;
  summary: string;
  concept_hierarchy: string[];
}

export interface RecommendResult {
  recommended_ids: string[];
  reason: string;
}

export interface Gemma4Plugin {
  /**
   * 检查模型状态（是否已下载、是否准备好）
   */
  checkModelStatus(): Promise<{ ready: boolean; progress: number; path?: string }>;

  /**
   * 尝试在系统中发现已存在的模型（如从其他已知 App 或公共目录）
   */
  discoverModel(): Promise<{ found: boolean; path?: string }>;

  /**
   * 触发模型下载（异步，前端可通过监听状态获取进度）
   */
  downloadModel(): Promise<void>;

  /**
   * 多模态识别：分析题目图片
   * @param options 包含图片的 Base64 数据
   */
  analyzeQuestion(options: { imageBase64: string }): Promise<QuestionAnalysis>;

  /**
   * 语义重排：根据用户需求从候选清单中推荐题目
   * @param options 包含需求文本和候选题目的精简 JSON
   */
  recommendQuestions(options: { 
    requirement: string; 
    candidatesJson: string; 
  }): Promise<RecommendResult>;
}

const Gemma4 = registerPlugin<Gemma4Plugin>('Gemma4', {
  web: () => ({
    checkModelStatus: async () => {
      console.log("[Gemma4 Web Mock] 检查模型状态...");
      return { ready: true, progress: 100, path: "web_mock_path" };
    },
    discoverModel: async () => {
      return { found: true, path: "web_mock_path" };
    },
    downloadModel: async () => {
      console.log("[Gemma4 Web Mock] 正在模拟下载...");
    },
    analyzeQuestion: async (options) => {
      console.log("[Gemma4 Web Mock] 正在分析图片...");
      await new Promise(r => setTimeout(r, 1500)); // 模拟延迟
      return {
        tags: ["模拟标签", "Web调试"],
        difficulty: 3,
        summary: "这是在 Web 模拟环境下生成的题目摘要，用于测试 UI 逻辑。",
        concept_hierarchy: ["调试", "Mock"]
      };
    },
    recommendQuestions: async (options) => {
      console.log("[Gemma4 Web Mock] 正在计算推荐...", options.requirement);
      const candidates = JSON.parse(options.candidatesJson);
      // 模拟挑选前 3 个
      return {
        recommended_ids: candidates.slice(0, 3).map((c: any) => c.id),
        reason: "这是 Web 仿真器根据您的要求: '" + options.requirement + "' 挑选的模拟结果。"
      };
    }
  })
});

// 关键修复：确保 Mock 在普通浏览器环境下也能被访问
if (typeof window !== 'undefined') {
  if (!(window as any).Capacitor) (window as any).Capacitor = { Plugins: {} };
  if (!(window as any).Capacitor.Plugins) (window as any).Capacitor.Plugins = {};
  (window as any).Capacitor.Plugins.Gemma4 = Gemma4;
}

export default Gemma4;

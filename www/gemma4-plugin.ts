import { registerPlugin } from '@capacitor/core';

export interface QuestionAnalysis {
  summary: string;
  difficulty: number;
  tags?: string[];
}

export interface RecommendResult {
  reason: string;
}

export interface Gemma4Plugin {
  checkModelStatus(): Promise<{ ready: boolean; downloaded: boolean; path: string }>;
  discoverModel(): Promise<{ found: boolean; ready: boolean; error?: string }>;
  analyzeQuestion(options: { prompt?: string }): Promise<QuestionAnalysis>;
  recommendQuestions(options: { requirement: string }): Promise<RecommendResult>;
  unloadModel(): Promise<void>;
}

const Gemma4 = registerPlugin<Gemma4Plugin>('Gemma4', {
  web: () => ({
    checkModelStatus: async () => {
      console.log("[Gemma4 Web Mock] 检查模型状态...");
      return { ready: true, downloaded: true, path: "web_mock_path" };
    },
    discoverModel: async () => {
      return { found: true, ready: true };
    },
    analyzeQuestion: async (options: { prompt?: string }) => {
      console.log("[Gemma4 Web Mock] 正在分析...", options.prompt);
      await new Promise(r => setTimeout(r, 1500));
      return {
        summary: "这是在 Web 模拟环境下生成的题目摘要，用于测试 UI 逻辑。",
        difficulty: 3
      };
    },
    recommendQuestions: async (options: { requirement: string }) => {
      console.log("[Gemma4 Web Mock] 正在计算推荐...", options.requirement);
      return {
        reason: "这是 Web 仿真器根据您的要求: '" + options.requirement + "' 挑选的模拟结果。"
      };
    },
    unloadModel: async () => {
      console.log("[Gemma4 Web Mock] 模型已卸载");
    }
  })
});

if (typeof window !== 'undefined') {
  if (!(window as any).Capacitor) (window as any).Capacitor = { Plugins: {} };
  if (!(window as any).Capacitor.Plugins) (window as any).Capacitor.Plugins = {};
  (window as any).Capacitor.Plugins.Gemma4 = Gemma4;
}

export default Gemma4;

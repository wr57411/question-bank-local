const STORAGE_KEY = 'wiki_budget_state';

export interface BudgetConfig {
  daily_compile_limit: number;
  monthly_token_budget: number;
  enable_paid_fallback: boolean;
}

export interface BudgetState {
  today_compiled: number;
  today_tokens: number;
  month_tokens: number;
  last_compile_date: string;
  last_compile_month: string;
}

const DEFAULT_CONFIG: BudgetConfig = {
  daily_compile_limit: 50,
  monthly_token_budget: 500000,
  enable_paid_fallback: false,
};

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function getConfig(): BudgetConfig {
  try {
    const saved = localStorage.getItem('wiki_budget_config');
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

export function setConfig(config: Partial<BudgetConfig>): void {
  const current = getConfig();
  localStorage.setItem('wiki_budget_config', JSON.stringify({ ...current, ...config }));
}

export function getBudgetState(): BudgetState {
  const today = getToday();
  const month = getMonth();

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const state = JSON.parse(saved) as BudgetState;
      if (state.last_compile_date !== today) {
        return { ...state, today_compiled: 0, today_tokens: 0, last_compile_date: today };
      }
      if (state.last_compile_month !== month) {
        return { ...state, month_tokens: 0, last_compile_month: month };
      }
      return state;
    }
  } catch { /* ignore */ }

  return {
    today_compiled: 0,
    today_tokens: 0,
    month_tokens: 0,
    last_compile_date: today,
    last_compile_month: month,
  };
}

export function addTokenUsage(tokens: number): void {
  const state = getBudgetState();
  state.today_compiled += 1;
  state.today_tokens += tokens;
  state.month_tokens += tokens;
  state.last_compile_date = getToday();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function checkBudget(): { allowed: boolean; reason?: string; remaining_daily: number; remaining_monthly: number } {
  const config = getConfig();
  const state = getBudgetState();

  const remaining_daily = config.daily_compile_limit - state.today_compiled;
  const remaining_monthly = config.monthly_token_budget - state.month_tokens;

  if (remaining_daily <= 0) {
    return { allowed: false, reason: `今日编译已达上限 (${config.daily_compile_limit} 题)，明天继续`, remaining_daily: 0, remaining_monthly };
  }
  if (remaining_monthly <= 0) {
    return { allowed: false, reason: `本月 Token 预算已用完 (${config.monthly_token_budget})`, remaining_daily, remaining_monthly: 0 };
  }

  return { allowed: true, remaining_daily, remaining_monthly };
}

export function getBudgetStatusText(): string {
  const config = getConfig();
  const state = getBudgetState();
  return `今日: ${state.today_compiled}/${config.daily_compile_limit} 题 | Token: ${Math.round(state.month_tokens / 1000)}K/${Math.round(config.monthly_token_budget / 1000)}K`;
}

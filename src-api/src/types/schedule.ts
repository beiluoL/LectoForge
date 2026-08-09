// 日程计划 / 每日任务 模块的类型契约（与前端 src/ui/api/schedule.ts 保持同名同构）。
//
// 重复规则 RepeatRule 是三选一的可辨识联合（discriminated union），
// 由 type 字段区分，与 wb_daily_task.repeat_rule / wb_task_template.tasks[].repeatRule 的 JSON 形态一致。
// 注意：JSON 落库后类型信息不丢（我们存的是完整对象，不是字符串枚举），
// 反序列化后由 type 收窄即可安全使用。

/** 每天重复：每 interval 天一次（interval=1 即每天） */
export interface RepeatRuleDaily {
  type: 'daily';
  interval: number;
}

/** 每周重复：days 为 0-6（0=周日, 6=周六），与 JS Date.getDay() 同口径 */
export interface RepeatRuleWeekly {
  type: 'weekly';
  days: number[];
}

/** 每月重复：每月 day 号（1-31，超出当月天数则该月不出现） */
export interface RepeatRuleMonthly {
  type: 'monthly';
  day: number;
}

export type RepeatRule = RepeatRuleDaily | RepeatRuleWeekly | RepeatRuleMonthly;

/** 模板里的单条任务（含可选的重复规则） */
export interface TemplateTask {
  content: string;
  /** 可选时间点，仅用于展示排序提示，不参与业务逻辑 */
  time?: string;
  /** 重复规则；null 表示仅生成一次（非重复） */
  repeatRule?: RepeatRule | null;
  /** 兼容模块一示例的简化写法 repeat:'DAILY'，归一化时转成 { type:'daily', interval:1 } */
  repeat?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
}

/** 模板 VO（对外） */
export interface TaskTemplateVO {
  id: number;
  name: string;
  tasks: TemplateTask[];
  createdAt: string;
  updatedAt: string;
}

/** 当日任务 VO（对外） */
export interface DailyTaskVO {
  id: number;
  targetDate: string;
  content: string;
  completed: boolean;
  parentTemplateId: number | null;
  repeatRule: RepeatRule | null;
  createdAt: string;
  updatedAt: string;
}

/* ===== 请求 DTO ===== */

export interface CreateTemplateDTO {
  name: string;
  tasks: TemplateTask[];
}

export interface GenerateDTO {
  templateId: number;
  targetDate: string;
}

export interface BatchAddDTO {
  targetDate: string;
  /** 每行一条任务文本，后端做 trim + 去空 */
  tasks: string[];
}

/** 更新当日任务：三个字段均可缺省（局部更新语义） */
export interface UpdateDailyTaskDTO {
  content?: string;
  completed?: boolean;
  /** 传 null 表示清除重复规则；不传则保持原值 */
  repeatRule?: RepeatRule | null;
}

export interface GenerateResult {
  /** 本次实际新建的当日任务 */
  created: DailyTaskVO[];
  /** 模板任务已全部存在（幂等，未新建任何行）时为 true，供前端提示「今日计划已生成」 */
  alreadyGenerated: boolean;
}

export interface BatchAddResult {
  created: DailyTaskVO[];
}

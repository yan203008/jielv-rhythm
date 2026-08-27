export type TaskStatus = 'pending' | 'complete' | 'cancelled';
export type Category = '健身' | '文章' | '视频' | '整理' | '学习' | '其他';
export type DayState = 'pressure' | 'steady' | 'positive';

export type Task = {
  id: string;
  title: string;
  category: Category;
  date: string;
  status: TaskStatus;
  completionNote?: string;
  projectId?: string;
  createdAt: string;
};

export type Project = {
  id: string;
  name: string;
  monthlyGoal: string;
  color: 'green' | 'orange' | 'blue' | 'purple';
};

export type NoteEntry = {
  id: string;
  date: string;
  time: string;
  text: string;
};

export type Experience = {
  id: string;
  date: string;
  title: string;
  note?: string;
};

export type HabitRecord = {
  dinner?: { complete: boolean; note?: string };
  sleep?: { complete: boolean; note?: string };
};

export type RoutineDocument = {
  version: 1;
  tasks: Task[];
  projects: Project[];
  notes: NoteEntry[];
  experiences: Experience[];
  dayStates: Record<string, DayState>;
  habits: Record<string, HabitRecord>;
};

export function uid(prefix = 'item') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, amount: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

export function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function starterDocument(now = new Date()): RoutineDocument {
  const monday = startOfWeek(now);
  const date = (offset: number) => formatDateKey(addDays(monday, offset));
  const createdAt = now.toISOString();
  const projects: Project[] = [
    {
      id: 'project_content',
      name: '内容创作',
      color: 'orange',
      monthlyGoal: '更新三篇内容\n  · 选题一：生活节律\n  · 选题二：注意力\n  · 选题三：月度复盘\n完成个人介绍的更新',
    },
    {
      id: 'project_health',
      name: '体能与健康',
      color: 'green',
      monthlyGoal: '保持每两天一次训练\n游泳只作为轻松的休闲项目',
    },
  ];

  return {
    version: 1,
    projects,
    tasks: [
      { id: 'seed_1', title: '健身', category: '健身', date: date(0), status: 'pending', projectId: 'project_health', createdAt },
      { id: 'seed_2', title: '梳理文章选题', category: '文章', date: date(0), status: 'pending', projectId: 'project_content', createdAt },
      { id: 'seed_3', title: '健身', category: '健身', date: date(2), status: 'pending', projectId: 'project_health', createdAt },
      { id: 'seed_4', title: '发布文章', category: '文章', date: date(4), status: 'pending', projectId: 'project_content', createdAt },
      { id: 'seed_5', title: '整理视频素材', category: '视频', date: date(5), status: 'pending', projectId: 'project_content', createdAt },
      { id: 'seed_6', title: '健身', category: '健身', date: date(6), status: 'pending', projectId: 'project_health', createdAt },
    ],
    experiences: [
      { id: 'experience_1', date: date(5), title: '看音乐秀', note: '一项值得留下来的生活体验。' },
    ],
    notes: [],
    dayStates: {},
    habits: {},
  };
}

export function normalizeDocument(value: Partial<RoutineDocument> | null | undefined): RoutineDocument {
  const fallback = starterDocument();
  if (!value) return fallback;
  return {
    version: 1,
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
    projects: Array.isArray(value.projects) ? value.projects : fallback.projects,
    notes: Array.isArray(value.notes) ? value.notes : [],
    experiences: Array.isArray(value.experiences) ? value.experiences : [],
    dayStates: value.dayStates ?? {},
    habits: value.habits ?? {},
  };
}

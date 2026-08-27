'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  Category,
  DayState,
  Experience,
  formatDateKey,
  HabitRecord,
  NoteEntry,
  normalizeDocument,
  parseDateKey,
  Project,
  RoutineDocument,
  startOfWeek,
  starterDocument,
  Task,
  uid,
} from './routine-data';
import { supabase } from './supabase';

type Page = 'plan' | 'projects' | 'notes';
type PlanView = 'week' | 'month';
type SyncState = 'loading' | 'saving' | 'saved' | 'error';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SHORT_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const CATEGORIES: Category[] = ['健身', '文章', '视频', '整理', '学习', '其他'];
const CATEGORY_CLASS: Record<Category, string> = {
  健身: 'green', 文章: 'orange', 视频: 'blue', 整理: 'purple', 学习: 'teal', 其他: 'gray',
};
const CATEGORY_SHORT: Record<Category, string> = {
  健身: '健', 文章: '文', 视频: '视', 整理: '整', 学习: '学', 其他: '事',
};
const STATE_META: Record<DayState, { label: string; color: string }> = {
  pressure: { label: '有压', color: 'pressure' },
  steady: { label: '平稳', color: 'steady' },
  positive: { label: '积极', color: 'positive' },
};

function dateLabel(key: string, withYear = false) {
  const date = parseDateKey(key);
  return `${withYear ? `${date.getFullYear()}年` : ''}${date.getMonth() + 1}月${date.getDate()}日`;
}

function dateTimeNow() {
  const now = new Date();
  return {
    date: formatDateKey(now),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  };
}

function monthBounds(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return [formatDateKey(first), formatDateKey(last)] as const;
}

function inRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function statusLabel(status: Task['status']) {
  if (status === 'complete') return '✓ 完成';
  if (status === 'cancelled') return '已取消';
  return '待完成';
}

export default function RoutineApp({ user }: { user: { id: string; name: string; onSignOut: () => void } }) {
  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => formatDateKey(today), [today]);
  const [doc, setDoc] = useState<RoutineDocument>(() => starterDocument(today));
  const [syncState, setSyncState] = useState<SyncState>('loading');
  const [page, setPage] = useState<Page>('plan');
  const [planView, setPlanView] = useState<PlanView>('week');
  const [weekCursor, setWeekCursor] = useState(() => startOfWeek(today));
  const [monthCursor, setMonthCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [fullWeek, setFullWeek] = useState(false);
  const [modal, setModal] = useState<'task-add' | 'task-edit' | 'experience' | 'habit' | 'project' | 'export' | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string>('project_content');
  const [activeHabit, setActiveHabit] = useState<'dinner' | 'sleep'>('dinner');
  const [noteDraft, setNoteDraft] = useState('');
  const [notesFull, setNotesFull] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const latestUpdatedAt = useRef(0);
  const cacheKey = `jielv-document:${user.id}`;

  useEffect(() => {
    const db = supabase!;
    let cancelled = false;
    const cached = window.localStorage.getItem(cacheKey);
    let cachedDocument: RoutineDocument | null = null;
    if (cached) {
      try {
        cachedDocument = normalizeDocument(JSON.parse(cached) as RoutineDocument);
        setDoc(cachedDocument);
      } catch {
        window.localStorage.removeItem(cacheKey);
      }
    }
    (async () => {
      try {
        const { data, error } = await db
          .from('routine_documents')
          .select('payload, updated_at')
          .eq('user_id', user.id)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        if (data?.payload) {
          const serverDocument = normalizeDocument(data.payload as RoutineDocument);
          latestUpdatedAt.current = Date.parse(data.updated_at);
          setDoc(serverDocument);
          window.localStorage.setItem(cacheKey, JSON.stringify(serverDocument));
          setSyncState('saved');
        } else {
          const initial = cachedDocument ?? starterDocument(today);
          setDoc(initial);
          setSyncState('saving');
          const updatedAt = new Date().toISOString();
          const { error: saveError } = await db.from('routine_documents').upsert({
            user_id: user.id,
            payload: initial,
            updated_at: updatedAt,
          });
          if (saveError) throw saveError;
          latestUpdatedAt.current = Date.parse(updatedAt);
          window.localStorage.setItem(cacheKey, JSON.stringify(initial));
          if (!cancelled) setSyncState('saved');
        }
      } catch {
        if (!cancelled) setSyncState('error');
      }
    })();

    const channel = db
      .channel(`routine-document:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'routine_documents', filter: `user_id=eq.${user.id}` },
        (event) => {
          const row = event.new as { payload?: RoutineDocument; updated_at?: string };
          const updatedAt = row.updated_at ? Date.parse(row.updated_at) : 0;
          if (!row.payload || updatedAt <= latestUpdatedAt.current) return;
          const next = normalizeDocument(row.payload);
          latestUpdatedAt.current = updatedAt;
          setDoc(next);
          window.localStorage.setItem(cacheKey, JSON.stringify(next));
          setSyncState('saved');
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [cacheKey, today, user.id]);

  async function commit(next: RoutineDocument) {
    setDoc(next);
    setSyncState('saving');
    window.localStorage.setItem(cacheKey, JSON.stringify(next));
    try {
      const updatedAt = new Date().toISOString();
      const { error } = await supabase!.from('routine_documents').upsert({
        user_id: user.id,
        payload: next,
        updated_at: updatedAt,
      });
      if (error) throw error;
      latestUpdatedAt.current = Date.parse(updatedAt);
      setSyncState('saved');
    } catch {
      setSyncState('error');
    }
  }

  function patchDoc(producer: (current: RoutineDocument) => RoutineDocument) {
    void commit(producer(doc));
  }

  const weekStart = useMemo(() => startOfWeek(weekCursor), [weekCursor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekStartKey = formatDateKey(weekDays[0]);
  const weekEndKey = formatDateKey(weekDays[6]);
  const monthStart = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const monthGridStart = startOfWeek(monthStart);
  const monthDays = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index)), [monthGridStart]);
  const [monthStartKey, monthEndKey] = monthBounds(monthCursor);
  const activeTask = doc.tasks.find((task) => task.id === activeTaskId) ?? null;
  const activeProject = doc.projects.find((project) => project.id === activeProjectId) ?? doc.projects[0];
  const selectedNotes = doc.notes.filter((note) => note.date === selectedDate).sort((a, b) => b.time.localeCompare(a.time));

  function openTask(taskId: string) {
    setActiveTaskId(taskId);
    setModal('task-edit');
  }

  function navigate(amount: number) {
    if (planView === 'week') {
      const next = addDays(weekStart, amount * 7);
      setWeekCursor(next);
      setSelectedDate(formatDateKey(next));
    } else {
      const next = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + amount, 1);
      setMonthCursor(next);
      setSelectedDate(formatDateKey(next));
    }
  }

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="side-brand"><span>律</span><strong>节律</strong></div>
        <nav aria-label="主导航">
          <NavButton active={page === 'plan'} icon="▦" label="计划" onClick={() => setPage('plan')} />
          <NavButton active={page === 'projects'} icon="◎" label="项目" onClick={() => setPage('projects')} />
          <NavButton active={page === 'notes'} icon="✎" label="随记" onClick={() => setPage('notes')} />
        </nav>
        <div className="user-chip" title={user.id}>
          <span>{user.name.slice(0, 1)}</span><div><b>{user.name}</b><button onClick={user.onSignOut}>退出</button></div>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-header">
          <div>
            <p className="eyebrow">{page === 'plan' ? 'PLANNING' : page === 'projects' ? 'GOAL DRIVEN' : 'DAILY NOTES'}</p>
            <h1>{page === 'plan' ? '计划' : page === 'projects' ? '项目推进' : '随记'}</h1>
          </div>
          <div className="header-actions">
            <span className={`sync-pill ${syncState}`}>{syncState === 'loading' ? '载入中' : syncState === 'saving' ? '保存中' : syncState === 'error' ? '保存失败' : '已同步'}</span>
            <button className="quiet-button" onClick={() => setModal('export')}>导出数据</button>
            <button className="icon-button" aria-label="新增" onClick={() => page !== 'notes' && setModal('task-add')}>＋</button>
          </div>
        </header>

        {page === 'plan' && (
          <PlanPage
            doc={doc}
            view={planView}
            setView={setPlanView}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            fullWeek={fullWeek}
            setFullWeek={setFullWeek}
            weekDays={weekDays}
            monthCursor={monthCursor}
            monthDays={monthDays}
            monthStartKey={monthStartKey}
            monthEndKey={monthEndKey}
            navigate={navigate}
            openTask={openTask}
            onAddTask={() => setModal('task-add')}
            onExperience={() => setModal('experience')}
            onHabit={(habit, date) => { setActiveHabit(habit); setSelectedDate(date); setModal('habit'); }}
          />
        )}

        {page === 'projects' && (
          <ProjectsPage
            doc={doc}
            activeProject={activeProject}
            setActiveProjectId={setActiveProjectId}
            onEditProject={() => setModal('project')}
            onAddTask={() => setModal('task-add')}
            openTask={openTask}
          />
        )}

        {page === 'notes' && (
          <NotesPage
            doc={doc}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            weekDays={weekDays}
            weekStart={weekStart}
            setWeekCursor={setWeekCursor}
            draft={noteDraft}
            setDraft={setNoteDraft}
            notes={selectedNotes}
            full={notesFull}
            setFull={setNotesFull}
            expanded={expandedNotes}
            setExpanded={setExpandedNotes}
            onState={(state) => patchDoc((current) => ({ ...current, dayStates: { ...current.dayStates, [selectedDate]: state } }))}
            onAddNote={() => {
              const text = noteDraft.trim();
              if (!text) return;
              const now = dateTimeNow();
              const entry: NoteEntry = { id: uid('note'), date: selectedDate, time: selectedDate === now.date ? now.time : '12:00', text };
              setNoteDraft('');
              patchDoc((current) => ({ ...current, notes: [...current.notes, entry] }));
            }}
            onDeleteNote={(id) => patchDoc((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== id) }))}
          />
        )}
      </main>

      {modal === 'task-add' && (
        <TaskAddModal
          date={selectedDate}
          projects={doc.projects}
          defaultProjectId={page === 'projects' ? activeProject?.id : undefined}
          onClose={() => setModal(null)}
          onSave={(task) => {
            patchDoc((current) => ({ ...current, tasks: [...current.tasks, task] }));
            setModal(null);
          }}
        />
      )}
      {modal === 'task-edit' && activeTask && (
        <TaskEditModal
          task={activeTask}
          onClose={() => setModal(null)}
          onSave={(nextTask) => {
            patchDoc((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === nextTask.id ? nextTask : task) }));
            setModal(null);
          }}
          onDelete={() => {
            patchDoc((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== activeTask.id) }));
            setModal(null);
          }}
        />
      )}
      {modal === 'experience' && (
        <ExperienceModal
          date={selectedDate}
          onClose={() => setModal(null)}
          onSave={(experience) => {
            patchDoc((current) => ({ ...current, experiences: [...current.experiences, experience] }));
            setModal(null);
          }}
        />
      )}
      {modal === 'habit' && (
        <HabitModal
          habit={activeHabit}
          date={selectedDate}
          record={doc.habits[selectedDate]}
          onClose={() => setModal(null)}
          onSave={(record) => {
            patchDoc((current) => ({ ...current, habits: { ...current.habits, [selectedDate]: { ...current.habits[selectedDate], [activeHabit]: record } } }));
            setModal(null);
          }}
        />
      )}
      {modal === 'project' && activeProject && (
        <ProjectModal
          project={activeProject}
          onClose={() => setModal(null)}
          onSave={(project) => {
            patchDoc((current) => ({ ...current, projects: current.projects.map((item) => item.id === project.id ? project : item) }));
            setModal(null);
          }}
        />
      )}
      {modal === 'export' && <ExportModal doc={doc} onClose={() => setModal(null)} initialStart={planView === 'week' ? weekStartKey : monthStartKey} initialEnd={planView === 'week' ? weekEndKey : monthEndKey} />}
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} aria-label={label} onClick={onClick}><span>{icon}</span><b>{label}</b></button>;
}

function PlanPage(props: {
  doc: RoutineDocument; view: PlanView; setView: (value: PlanView) => void; selectedDate: string; setSelectedDate: (value: string) => void;
  fullWeek: boolean; setFullWeek: (value: boolean) => void; weekDays: Date[]; monthCursor: Date; monthDays: Date[];
  monthStartKey: string; monthEndKey: string; navigate: (amount: number) => void; openTask: (id: string) => void;
  onAddTask: () => void; onExperience: () => void; onHabit: (habit: 'dinner' | 'sleep', date: string) => void;
}) {
  const { doc, view, setView, selectedDate, setSelectedDate, fullWeek, setFullWeek, weekDays, monthCursor, monthDays, monthStartKey, monthEndKey, navigate, openTask, onAddTask, onExperience, onHabit } = props;
  const weekStartKey = formatDateKey(weekDays[0]);
  const weekEndKey = formatDateKey(weekDays[6]);
  const visibleTasks = doc.tasks.filter((task) => inRange(task.date, view === 'week' ? weekStartKey : monthStartKey, view === 'week' ? weekEndKey : monthEndKey));
  const visibleExperiences = doc.experiences.filter((item) => inRange(item.date, view === 'week' ? weekStartKey : monthStartKey, view === 'week' ? weekEndKey : monthEndKey));
  const selectedItems = [...doc.tasks.filter((task) => task.date === selectedDate), ...doc.experiences.filter((item) => item.date === selectedDate)];

  return (
    <>
      <section className="planner-card">
        <div className="planner-topline">
          <div className="view-switch"><button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>周</button><button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>月</button></div>
          <div className="date-navigation"><button onClick={() => navigate(-1)} aria-label="上一周期">‹</button><strong>{view === 'week' ? `${dateLabel(weekStartKey)} — ${dateLabel(weekEndKey)}` : `${monthCursor.getFullYear()}年${monthCursor.getMonth() + 1}月`}</strong><button onClick={() => navigate(1)} aria-label="下一周期">›</button></div>
        </div>

        {view === 'week' ? (
          <>
            <div className="week-toolbar"><strong>七天安排</strong><button className="quiet-button" onClick={() => setFullWeek(!fullWeek)}>{fullWeek ? '一屏纵览' : '完整展示'}</button></div>
            <div className={`week-grid ${fullWeek ? 'full' : ''}`}>
              {weekDays.map((day, index) => {
                const key = formatDateKey(day);
                const dayTasks = doc.tasks.filter((task) => task.date === key && task.status !== 'cancelled');
                const dayExperiences = doc.experiences.filter((item) => item.date === key);
                return (
                  <div className="day-column" key={key}>
                    <button className={`day-head ${selectedDate === key ? 'selected' : ''}`} onClick={() => setSelectedDate(key)}><span>{WEEKDAYS[index]}</span><strong>{day.getDate()}</strong></button>
                    <div className={`day-tasks ${selectedDate === key ? 'selected' : ''}`}>
                      {dayTasks.map((task) => <button key={task.id} className={`task-token ${CATEGORY_CLASS[task.category]} ${task.status}`} onClick={() => openTask(task.id)}>{fullWeek ? task.title : CATEGORY_SHORT[task.category]}{task.status === 'complete' ? ' ✓' : ''}</button>)}
                      {dayExperiences.map((item) => <button key={item.id} className="task-token rose" onClick={() => setSelectedDate(key)}>{fullWeek ? item.title : '记'}</button>)}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="month-calendar">
            {SHORT_WEEKDAYS.map((day) => <b className="month-weekday" key={day}>{day}</b>)}
            {monthDays.map((day) => {
              const key = formatDateKey(day);
              const tasks = doc.tasks.filter((task) => task.date === key && task.status !== 'cancelled');
              const experiences = doc.experiences.filter((item) => item.date === key);
              const outside = day.getMonth() !== monthCursor.getMonth();
              return (
                <button className={`month-day ${outside ? 'outside' : ''} ${selectedDate === key ? 'selected' : ''}`} key={key} onClick={() => setSelectedDate(key)}>
                  <span>{day.getDate()}</span>
                  <i className="month-dots">{tasks.slice(0, 4).map((task) => <em key={task.id} className={CATEGORY_CLASS[task.category]} title={task.title} />)}{experiences.slice(0, 1).map((item) => <em key={item.id} className="rose" title={item.title} />)}</i>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {view === 'week' ? (
        <section className="detail-section">
          <div className="section-heading"><div><p className="eyebrow">WEEK DETAILS</p><h2>本周详情</h2></div><div><button className="text-button" onClick={onExperience}>记录经历</button><button className="text-button" onClick={onAddTask}>添加计划</button></div></div>
          <div className="week-detail-stack">
            {weekDays.map((day, index) => {
              const key = formatDateKey(day);
              const tasks = doc.tasks.filter((task) => task.date === key);
              const experiences = doc.experiences.filter((item) => item.date === key);
              const habit = doc.habits[key] ?? {};
              return (
                <article className="week-detail-day" key={key}>
                  <header><span>{WEEKDAYS[index]}</span><strong>{day.getMonth() + 1}/{day.getDate()}</strong></header>
                  <div className="week-detail-items">
                    {tasks.map((task) => <button className={`detail-row mini ${task.status}`} key={task.id} onClick={() => openTask(task.id)}><span className={`category-dot ${CATEGORY_CLASS[task.category]}`} /><span><strong>{task.title}</strong><small>{statusLabel(task.status)}{task.completionNote ? ` · ${task.completionNote}` : ''}</small></span><em>打开</em></button>)}
                    {experiences.map((item) => <div className="detail-row mini" key={item.id}><span className="category-dot rose" /><span><strong>{item.title}</strong><small>{item.note || '生活记录'}</small></span><em>经历</em></div>)}
                    <div className="habit-buttons">
                      <button className={habit.dinner?.complete ? 'done' : ''} onClick={() => onHabit('dinner', key)}>晚餐 19:30 前 {habit.dinner?.complete ? '✓' : ''}</button>
                      <button className={habit.sleep?.complete ? 'done' : ''} onClick={() => onHabit('sleep', key)}>22:40 睡觉 {habit.sleep?.complete ? '✓' : ''}</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="detail-section month-summary-section">
          <div className="section-heading"><div><p className="eyebrow">MONTH SUMMARY</p><h2>核心任务</h2></div><div><button className="text-button" onClick={onExperience}>记录经历</button><button className="text-button" onClick={onAddTask}>添加计划</button></div></div>
          <div className="month-summary-grid">
            {CATEGORIES.filter((category) => visibleTasks.some((task) => task.category === category)).map((category, index) => (
              <article className="summary-line" key={category}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{category}：</strong>{visibleTasks.filter((task) => task.category === category).map((task) => task.title).join('、')}</span></article>
            ))}
            {visibleExperiences.length > 0 && <article className="summary-line"><b>{String(CATEGORIES.filter((category) => visibleTasks.some((task) => task.category === category)).length + 1).padStart(2, '0')}</b><span><strong>生活：</strong>{visibleExperiences.map((item) => item.title).join('、')}</span></article>}
          </div>
          <div className="selected-date-list"><h3>{dateLabel(selectedDate)} · 每条安排</h3>{selectedItems.length ? selectedItems.map((item) => 'status' in item ? <button key={item.id} className="selected-item" onClick={() => openTask(item.id)}><i className={`category-dot ${CATEGORY_CLASS[item.category]}`} /><span>{item.title}</span><em>{statusLabel(item.status)}</em></button> : <div className="selected-item" key={item.id}><i className="category-dot rose" /><span>{item.title}</span><em>经历</em></div>) : <p className="empty-inline">没有额外安排</p>}</div>
        </section>
      )}
    </>
  );
}

function ProjectsPage({ doc, activeProject, setActiveProjectId, onEditProject, onAddTask, openTask }: { doc: RoutineDocument; activeProject?: Project; setActiveProjectId: (id: string) => void; onEditProject: () => void; onAddTask: () => void; openTask: (id: string) => void }) {
  const [goalExpanded, setGoalExpanded] = useState(false);
  if (!activeProject) return <section className="empty-panel"><h2>还没有项目</h2><p>先添加一项带项目归属的计划。</p></section>;
  const tasks = doc.tasks.filter((task) => task.projectId === activeProject.id).sort((a, b) => a.date.localeCompare(b.date));
  const complete = tasks.filter((task) => task.status === 'complete').length;
  const progress = tasks.length ? Math.round((complete / tasks.length) * 100) : 0;
  const groups = new Map<string, Task[]>();
  tasks.forEach((task) => {
    const start = formatDateKey(startOfWeek(parseDateKey(task.date)));
    const existing = groups.get(start) ?? [];
    existing.push(task);
    groups.set(start, existing);
  });
  const goalLines = activeProject.monthlyGoal.split('\n').filter(Boolean);
  const defaultLines = goalLines.filter((line) => !/^\s*[·•-]/.test(line));

  return (
    <>
      <section className="project-tabs">{doc.projects.map((project) => <button key={project.id} className={activeProject.id === project.id ? 'active' : ''} onClick={() => setActiveProjectId(project.id)}><i className={`project-dot ${project.color}`} />{project.name}</button>)}</section>
      <section className="project-hero">
        <div><p className="eyebrow">CURRENT PROJECT</p><h2>{activeProject.name}</h2><p>{complete}/{tasks.length} 项已完成</p></div>
        <strong>{progress}%</strong>
        <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
      </section>
      <section className="project-route">
        <div className="section-heading"><div><p className="eyebrow">MONTH ROUTE</p><h2>月路线</h2></div><button className="quiet-button" onClick={onEditProject}>编辑目标</button></div>
        <div className="goal-copy">{(goalExpanded ? goalLines : defaultLines).map((line, index) => <p key={`${line}-${index}`} className={/^\s*[·•-]/.test(line) ? 'subgoal' : ''}>{line.trim()}</p>)}</div>
        {goalLines.length > defaultLines.length && <button className="text-button expand-goal" onClick={() => setGoalExpanded(!goalExpanded)}>{goalExpanded ? '收起详情' : '展开详情'}</button>}
      </section>
      <section className="project-weeks">
        <div className="section-heading"><div><p className="eyebrow">WEEKLY PROGRESS</p><h2>按周推进</h2></div><button className="text-button" onClick={onAddTask}>添加项目任务</button></div>
        {[...groups.entries()].map(([start, group]) => {
          const end = formatDateKey(addDays(parseDateKey(start), 6));
          return <article className="project-week" key={start}><header><span>{dateLabel(start)} — {dateLabel(end)}</span><b>{group.filter((task) => task.status === 'complete').length}/{group.length}</b></header><div>{group.map((task) => <button key={task.id} className={`project-task ${task.status}`} onClick={() => openTask(task.id)}><i className={`category-dot ${CATEGORY_CLASS[task.category]}`} /><span><strong>{task.title}</strong><small>{dateLabel(task.date)} · {statusLabel(task.status)}</small></span><em>打开</em></button>)}</div></article>;
        })}
        {!tasks.length && <p className="empty-inline">这个项目还没有安排任务。</p>}
      </section>
    </>
  );
}

function NotesPage(props: {
  doc: RoutineDocument; selectedDate: string; setSelectedDate: (date: string) => void; weekDays: Date[]; weekStart: Date; setWeekCursor: (date: Date) => void;
  draft: string; setDraft: (value: string) => void; notes: NoteEntry[]; full: boolean; setFull: (value: boolean) => void;
  expanded: Record<string, boolean>; setExpanded: (value: Record<string, boolean>) => void; onState: (state: DayState) => void; onAddNote: () => void; onDeleteNote: (id: string) => void;
}) {
  const { doc, selectedDate, setSelectedDate, weekDays, weekStart, setWeekCursor, draft, setDraft, notes, full, setFull, expanded, setExpanded, onState, onAddNote, onDeleteNote } = props;
  const selectedState = doc.dayStates[selectedDate];
  const month = parseDateKey(selectedDate);
  const [start, end] = monthBounds(month);
  const monthStates = Object.entries(doc.dayStates).filter(([date]) => inRange(date, start, end));
  const counts: Record<DayState, number> = { pressure: 0, steady: 0, positive: 0 };
  monthStates.forEach(([, state]) => { counts[state] += 1; });
  const max = Math.max(1, monthStates.length);

  return (
    <>
      <section className="notes-calendar-card">
        <div className="date-navigation note-nav"><button onClick={() => setWeekCursor(addDays(weekStart, -7))}>‹</button><strong>{dateLabel(formatDateKey(weekDays[0]))} — {dateLabel(formatDateKey(weekDays[6]))}</strong><button onClick={() => setWeekCursor(addDays(weekStart, 7))}>›</button></div>
        <div className="notes-week">{weekDays.map((day, index) => { const key = formatDateKey(day); const state = doc.dayStates[key]; return <button key={key} className={`${selectedDate === key ? 'selected' : ''} ${state ? STATE_META[state].color : ''}`} onClick={() => setSelectedDate(key)}><span>{WEEKDAYS[index]}</span><strong>{day.getDate()}</strong>{state && <i />}</button>; })}</div>
      </section>
      <section className="state-card"><b>当天状态</b><div className={`state-options ${selectedState ? 'has-selection' : ''}`}>{(Object.keys(STATE_META) as DayState[]).map((state) => <button key={state} className={`${STATE_META[state].color} ${selectedState === state ? 'selected' : ''}`} onClick={() => onState(state)}>{STATE_META[state].label}</button>)}</div></section>
      <section className="note-compose"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="想到什么，就先记下来……" rows={4} /><button className="primary-button compact" onClick={onAddNote}>记录</button></section>
      <section className="note-history">
        <div className="section-heading"><div><p className="eyebrow">HISTORY</p><h2>{dateLabel(selectedDate)} · {notes.length} 条</h2></div>{notes.length > 0 && <button className="quiet-button" onClick={() => setFull(!full)}>{full ? '预览' : '完整'}</button>}</div>
        <div className="note-list">{notes.map((note) => { const isOpen = full || expanded[note.id]; return <article className={`note-row ${isOpen ? 'open' : ''}`} key={note.id} onClick={() => setExpanded({ ...expanded, [note.id]: !expanded[note.id] })}><time>{note.time}</time><p>{note.text}</p><button aria-label="删除" onClick={(event) => { event.stopPropagation(); onDeleteNote(note.id); }}>×</button></article>; })}</div>
      </section>
      <section className="state-distribution"><div className="section-heading"><div><p className="eyebrow">MONTHLY DISTRIBUTION</p><h2>{month.getMonth() + 1}月状态分布</h2></div><span>{monthStates.length} 天已记录</span></div>{(Object.keys(STATE_META) as DayState[]).map((state) => <div className="distribution-row" key={state}><b>{STATE_META[state].label}</b><div><i className={STATE_META[state].color} style={{ width: `${counts[state] / max * 100}%` }} /></div><em>{counts[state]}</em></div>)}</section>
    </>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true"><header><div><p className="eyebrow">QUICK EDIT</p><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}</div><button onClick={onClose} aria-label="关闭">×</button></header>{children}</section></div>;
}

function TaskAddModal({ date, projects, defaultProjectId, onClose, onSave }: { date: string; projects: Project[]; defaultProjectId?: string; onClose: () => void; onSave: (task: Task) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const category = data.get('category') as Category;
    const title = String(data.get('title') || '').trim() || category;
    const projectId = String(data.get('projectId') || '');
    onSave({ id: uid('task'), title, category, date: String(data.get('date')), status: 'pending', projectId: projectId || undefined, createdAt: new Date().toISOString() });
  }
  return <Modal title="添加计划" subtitle="只填最必要的信息" onClose={onClose}><form className="modal-form" onSubmit={submit}><label><span>类别</span><select name="category" defaultValue="健身">{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>名称</span><input name="title" placeholder="可留空，默认使用类别名" /></label><label><span>日期</span><input name="date" type="date" defaultValue={date} required /></label><label><span>所属项目</span><select name="projectId" defaultValue={defaultProjectId || ''}><option value="">无</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><button className="primary-button form-submit" type="submit">添加计划</button></form></Modal>;
}

function TaskEditModal({ task, onClose, onSave, onDelete }: { task: Task; onClose: () => void; onSave: (task: Task) => void; onDelete: () => void }) {
  const [note, setNote] = useState(task.completionNote ?? '');
  const [date, setDate] = useState(task.date);
  return <Modal title={task.title} subtitle={`${task.category} · ${dateLabel(task.date)}`} onClose={onClose}><div className="task-action-form"><label><span>完成情况（选填）</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="比如吃了什么、练了什么、感受如何……" /></label><div className="task-actions"><button className="action-complete" onClick={() => onSave({ ...task, status: 'complete', completionNote: note.trim() || undefined })}>✓ 已完成</button><button className="action-cancel" onClick={() => onSave({ ...task, status: 'cancelled', completionNote: note.trim() || undefined })}>取消</button></div><div className="reschedule-row"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button onClick={() => onSave({ ...task, date, status: 'pending' })}>改到这一天</button></div>{task.status !== 'pending' && <button className="text-button restore-button" onClick={() => onSave({ ...task, status: 'pending' })}>恢复为待完成</button>}<button className="danger-text" onClick={onDelete}>删除任务</button></div></Modal>;
}

function ExperienceModal({ date, onClose, onSave }: { date: string; onClose: () => void; onSave: (item: Experience) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const title = String(data.get('title') || '').trim(); if (!title) return; onSave({ id: uid('experience'), date: String(data.get('date')), title, note: String(data.get('note') || '').trim() || undefined }); }
  return <Modal title="记录一次经历" subtitle="朋友、电影、演出或任何值得留下的事" onClose={onClose}><form className="modal-form" onSubmit={submit}><label><span>发生了什么</span><input name="title" required placeholder="例如：和朋友吃饭" /></label><label><span>日期</span><input name="date" type="date" defaultValue={date} required /></label><label><span>补充（选填）</span><textarea name="note" rows={4} /></label><button className="primary-button form-submit" type="submit">保存记录</button></form></Modal>;
}

function HabitModal({ habit, date, record, onClose, onSave }: { habit: 'dinner' | 'sleep'; date: string; record?: HabitRecord; onClose: () => void; onSave: (record: { complete: boolean; note?: string }) => void }) {
  const current = record?.[habit];
  const [note, setNote] = useState(current?.note ?? '');
  const label = habit === 'dinner' ? '晚餐 19:30 前结束' : '22:40 放下手机，准备睡觉';
  return <Modal title={label} subtitle={dateLabel(date)} onClose={onClose}><div className="task-action-form"><label><span>当天情况（选填）</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="primary-button form-submit" onClick={() => onSave({ complete: true, note: note.trim() || undefined })}>{current?.complete ? '更新记录' : '✓ 完成打卡'}</button>{current?.complete && <button className="text-button restore-button" onClick={() => onSave({ complete: false, note: note.trim() || undefined })}>撤销完成</button>}</div></Modal>;
}

function ProjectModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (project: Project) => void }) {
  const [name, setName] = useState(project.name);
  const [goal, setGoal] = useState(project.monthlyGoal);
  return <Modal title="编辑项目月路线" subtitle="主标题单独一行，子项以 · 开头" onClose={onClose}><div className="modal-form"><label><span>项目名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>本月目标与子项</span><textarea rows={9} value={goal} onChange={(event) => setGoal(event.target.value)} /></label><button className="primary-button form-submit" onClick={() => onSave({ ...project, name: name.trim() || project.name, monthlyGoal: goal.trim() })}>保存目标</button></div></Modal>;
}

function ExportModal({ doc, onClose, initialStart, initialEnd }: { doc: RoutineDocument; onClose: () => void; initialStart: string; initialEnd: string }) {
  const [includePlans, setIncludePlans] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);

  function subset() {
    const tasks = doc.tasks.filter((task) => inRange(task.date, start, end));
    const experiences = doc.experiences.filter((item) => inRange(item.date, start, end));
    const notes = doc.notes.filter((note) => inRange(note.date, start, end));
    const dayStates = Object.fromEntries(Object.entries(doc.dayStates).filter(([date]) => inRange(date, start, end)));
    const habits = Object.fromEntries(Object.entries(doc.habits).filter(([date]) => inRange(date, start, end)));
    return { period: { start, end }, projects: includePlans ? doc.projects : [], tasks: includePlans ? tasks : [], experiences: includePlans ? experiences : [], habits: includePlans ? habits : {}, notes: includeNotes ? notes : [], dayStates: includeNotes ? dayStates : {} };
  }

  function download(content: string, extension: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `节律_${start}_${end}.${extension}`; link.click();
    URL.revokeObjectURL(url);
  }

  function markdown() {
    const data = subset();
    const lines = [`# 节律数据导出`, ``, `时间：${start} 至 ${end}`, ``];
    if (includePlans) {
      lines.push('## 计划及完成情况', '');
      data.tasks.forEach((task) => lines.push(`- ${task.date}｜${task.category}｜${task.title}｜${statusLabel(task.status)}${task.completionNote ? `｜${task.completionNote}` : ''}`));
      lines.push('', '### 固定节律', '');
      Object.entries(data.habits).forEach(([date, habit]) => {
        if (habit.dinner) lines.push(`- ${date}｜晚餐 19:30 前｜${habit.dinner.complete ? '完成' : '未完成'}${habit.dinner.note ? `｜${habit.dinner.note}` : ''}`);
        if (habit.sleep) lines.push(`- ${date}｜22:40 睡觉｜${habit.sleep.complete ? '完成' : '未完成'}${habit.sleep.note ? `｜${habit.sleep.note}` : ''}`);
      });
      lines.push('', '### 生活经历', '');
      data.experiences.forEach((item) => lines.push(`- ${item.date}｜${item.title}${item.note ? `｜${item.note}` : ''}`));
      lines.push('');
    }
    if (includeNotes) {
      lines.push('## 随记', '');
      Object.entries(data.dayStates).sort().forEach(([date, state]) => lines.push(`### ${date}｜${STATE_META[state as DayState].label}`, '', ...data.notes.filter((note) => note.date === date).sort((a, b) => a.time.localeCompare(b.time)).map((note) => `- ${note.time}｜${note.text}`), ''));
      data.notes.filter((note) => !data.dayStates[note.date]).forEach((note) => lines.push(`- ${note.date} ${note.time}｜${note.text}`));
    }
    return lines.join('\n');
  }

  return <Modal title="导出数据" subtitle="按需选择内容和时间，不生成结论" onClose={onClose}><div className="export-form"><fieldset><legend>导出内容</legend><label><input type="checkbox" checked={includePlans} onChange={(event) => setIncludePlans(event.target.checked)} />计划及完成情况</label><label><input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} />随记</label></fieldset><div className="export-dates"><label><span>开始日期</span><input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label><span>结束日期</span><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div><p>Markdown 适合直接发给 Agent 阅读；JSON 适合备份或以后迁移。</p><div className="export-actions"><button disabled={!includePlans && !includeNotes} className="primary-button compact" onClick={() => download(markdown(), 'md', 'text/markdown;charset=utf-8')}>导出 Markdown</button><button disabled={!includePlans && !includeNotes} className="quiet-button" onClick={() => download(JSON.stringify(subset(), null, 2), 'json', 'application/json')}>导出 JSON</button></div></div></Modal>;
}

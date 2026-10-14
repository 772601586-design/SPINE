import { api } from '../../../services/api';
import { requireOnboarded } from '../../../services/session';
import type { ExerciseTaxonomy, ExerciseVersion } from '../../../models/types';

type FilterGroup = 'regions' | 'muscles' | 'goals' | 'postures' | 'equipment' | 'categories';
type FilterParams = { region?: string; muscle?: string; goal?: string; posture?: string; equipment?: string; category?: string };
Page({
  data: {
    loading: true, error: '', taxonomy: { regions: [], muscles: [], goals: [], postures: [], equipment: [] } as ExerciseTaxonomy,
    exercises: [] as ExerciseVersion[], selectedRegion: '', selectedMuscle: '', selectedGoal: '',
    selectedPosture: '', selectedEquipment: '', selectedCategory: '',
    categories: [{ code: 'general_fitness', name: '一般训练' }, { code: 'scoliosis_specific', name: '侧弯专项' }],
    selectedExercise: 0, added: {} as Record<number, boolean>, adding: 0,
  },
  async onLoad() {
    if (!await requireOnboarded()) return;
    await this.load();
  },
  async load(filters?: FilterParams) {
    this.setData({ loading: true, error: '' });
    try {
      const taxonomy = await api.exerciseTaxonomy();
      const exercises = await api.exercises(filters ?? {
        region: this.data.selectedRegion, muscle: this.data.selectedMuscle, goal: this.data.selectedGoal,
        posture: this.data.selectedPosture, equipment: this.data.selectedEquipment, category: this.data.selectedCategory,
      });
      this.setData({ taxonomy, exercises, loading: false, selectedExercise: 0 });
    } catch (error) {
      this.setData({ loading: false, error: error instanceof Error ? error.message : '暂时无法加载动作库' });
    }
  },
  retry() { void this.load(); },
  selectFilter(event: { currentTarget: { dataset: { group: FilterGroup; code: string } } }) {
    const { group, code } = event.currentTarget.dataset;
    const keys: Record<FilterGroup, keyof FilterParams> = { regions: 'region', muscles: 'muscle', goals: 'goal', postures: 'posture', equipment: 'equipment', categories: 'category' };
    const dataKeys: Record<FilterGroup, 'selectedRegion' | 'selectedMuscle' | 'selectedGoal' | 'selectedPosture' | 'selectedEquipment' | 'selectedCategory'> = {
      regions: 'selectedRegion', muscles: 'selectedMuscle', goals: 'selectedGoal', postures: 'selectedPosture', equipment: 'selectedEquipment', categories: 'selectedCategory',
    };
    const current = this.data[dataKeys[group]];
    const next = current === code ? '' : code;
    const filters: FilterParams = { region: this.data.selectedRegion, muscle: this.data.selectedMuscle, goal: this.data.selectedGoal,
      posture: this.data.selectedPosture, equipment: this.data.selectedEquipment, category: this.data.selectedCategory };
    filters[keys[group]] = next;
    this.setData({ [dataKeys[group]]: next });
    void this.load(filters);
  },
  toggleExercise(event: { currentTarget: { dataset: { id: number } } }) {
    const id = Number(event.currentTarget.dataset.id);
    this.setData({ selectedExercise: this.data.selectedExercise === id ? 0 : id });
  },
  async addToPlan(event: { currentTarget: { dataset: { id: string } } }) {
    const id = Number(event.currentTarget.dataset.id);
    if (this.data.adding) return;
    this.setData({ adding: id });
    try {
      await api.addActionCard(id);
      this.setData({ [`added.${id}`]: true, adding: 0 });
      wx.showToast({ title: '已加入我的训练计划', icon: 'success' });
    } catch (error) {
      this.setData({ adding: 0 });
      wx.showToast({ title: error instanceof Error ? error.message : '添加失败，请重试', icon: 'none' });
    }
  },
  openPlan() { wx.navigateBack({ delta: 1 }); },
  clearFilters() {
    const filters = { region: '', muscle: '', goal: '', posture: '', equipment: '', category: '' };
    this.setData({ selectedRegion: '', selectedMuscle: '', selectedGoal: '', selectedPosture: '', selectedEquipment: '', selectedCategory: '' });
    void this.load(filters);
  },
});

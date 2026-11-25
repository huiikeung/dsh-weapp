/**
 * 新建 Bot（对齐 dsh-mobile BotCreationView / iOS 规格 §7.2 新建 Bot、§7.3 编辑形象、§7.4 模型选择）：
 * 形象（52 头像瓷片 + 编辑面板）/ 名字（占位自动名 + 本地校验）/ 运行方式分段控件 /
 * 本地 Agent 列表（加载中/失败重试/空/可用与禁用/选中）/ 模型行与选择面板（云端含思考强度）/
 * 底部胶囊提交（saving 白色 Spinner），成功 createdId 非空后 pop 回上一页。
 */
import {
  BOT_BG_DEFAULT, BotAvatarPhoto, BotCreationAgent, BotCreationAppearance, BotCreationColor, BotCreationShape,
  BotPalette, botPalette, BotRoleOption, BotSnapshot, BotStore, emptyBotSnapshot
} from 'nativecore';
import { NavBackButton } from '../components/NavBackButton';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { image } from '@kit.ImageKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';

/** iOS §8.1 Bot 色板（浅色 / 深色） */
function ink(dark: boolean): string {
  return dark ? '#F2EEF6' : '#252332';
}

function secondary(dark: boolean): string {
  return dark ? '#D8D2E1' : '#5C536C';
}

function purple(dark: boolean): string {
  return dark ? '#C8B5E8' : '#7760B4';
}

function lavenderSoft(dark: boolean): string {
  return dark ? '#333044' : '#ECE7F7';
}

function card(dark: boolean): string {
  return dark ? '#292733' : '#FFFFFF';
}

function line(dark: boolean): string {
  return dark ? '#484354' : '#DAD6E3';
}

function canvas(dark: boolean): string {
  return dark ? '#1B1924' : '#F5F3F9';
}

/** 管理页 action / rim / danger（§8.1） */
const ACTION: string = '#6C50A7';
const RIM_DARK: string = '#777184';
const DANGER: string = '#D6263C';

/** 对齐 BotCreationRules：名字 40 字、头像 110KB / 512px。 */
const NAME_LIMIT: number = 40;
const PHOTO_BYTES: number = 110000;
const PHOTO_SIDE: number = 512;
const RESERVED_NAMES: string[] = ['all', 'everyone', '所有人', '全体', 'user', 'you'];
const DULL_COLORS: string[] = ['black', 'gray', 'brown', 'aurora'];

interface LookPair {
  shape: string;
  color: string;
}

/**
 * 选照片 → 边长压到 512 → JPEG 压到 ≤110KB → data URL（对齐规格 §7.3 照片规则）。
 * 返回空串表示用户取消选择。
 */
async function pickPhotoDataUrl(): Promise<string> {
  const picker: photoAccessHelper.PhotoViewPicker = new photoAccessHelper.PhotoViewPicker();
  const options: photoAccessHelper.PhotoSelectOptions = new photoAccessHelper.PhotoSelectOptions();
  options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
  options.maxSelectNumber = 1;
  const selected: photoAccessHelper.PhotoSelectResult = await picker.select(options);
  if (selected.photoUris.length === 0) {
    return '';
  }
  const file = fileIo.openSync(selected.photoUris[0], fileIo.OpenMode.READ_ONLY);
  const source: image.ImageSource = image.createImageSource(file.fd);
  const info: image.ImageInfo = await source.getImageInfo();
  let width: number = info.size.width;
  let height: number = info.size.height;
  const maxSide: number = Math.max(width, height);
  if (maxSide > PHOTO_SIDE) {
    const scale: number = PHOTO_SIDE / maxSide;
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }
  const pixelMap: image.PixelMap = await source.createPixelMap({ desiredSize: { width: width, height: height } });
  const packer: image.ImagePacker = image.createImagePacker();
  let quality: number = 85;
  let buffer: ArrayBuffer = await packer.packing(pixelMap, { format: 'image/jpeg', quality: quality });
  while (buffer.byteLength > PHOTO_BYTES && quality > 20) {
    quality -= 10;
    buffer = await packer.packing(pixelMap, { format: 'image/jpeg', quality: quality });
  }
  await packer.release();
  fileIo.closeSync(file);
  await pixelMap.release();
  await source.release();
  if (buffer.byteLength > PHOTO_BYTES) {
    throw new Error('too-large');
  }
  const helper: util.Base64Helper = new util.Base64Helper();
  const base64: string = helper.encodeToStringSync(new Uint8Array(buffer));
  return 'data:image/jpeg;base64,' + base64;
}

@Component
export struct BotCreatePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  /** Bot 背景配色：本页底色与主按钮也跟着主题（新建 Bot 仍保持二级页，只改配色） */
  @StorageLink('botBgTheme') botBgTheme: string = BOT_BG_DEFAULT;

  private palette(): BotPalette {
    return botPalette(this.botBgTheme);
  }

  private canvasColor(): string {
    const palette: BotPalette = this.palette();
    return this.isDark ? palette.baseDark : palette.base;
  }

  private actionColor(): string {
    const palette: BotPalette = this.palette();
    return this.isDark ? palette.actionDark : palette.action;
  }

  /** 分段控件 / Tab 的选中态底色：主题淡色 */
  private segmentSelectedColor(): string {
    const palette: BotPalette = this.palette();
    const rgb: number[] = this.isDark ? palette.fluidToDark : palette.fluidFrom;
    const alpha: number = this.isDark ? 0.32 : 0.40;
    return 'rgba(' + Math.round(rgb[0] * 255) + ',' + Math.round(rgb[1] * 255) + ','
      + Math.round(rgb[2] * 255) + ',' + alpha.toString() + ')';
  }

  /** 形象选择里头像块的 hover / 选中底：跟随主题 */
  private lookTileColor(selected: boolean): string {
    const palette: BotPalette = this.palette();
    const rgb: number[] = this.isDark ? palette.fluidToDark : palette.fluidFrom;
    let alpha: number = this.isDark ? 0.18 : 0.10;
    if (selected) {
      alpha = this.isDark ? 0.42 : 0.30;
    }
    return 'rgba(' + Math.round(rgb[0] * 255) + ',' + Math.round(rgb[1] * 255) + ','
      + Math.round(rgb[2] * 255) + ',' + alpha.toString() + ')';
  }
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('safeBottomVp') safeBottom: number = 0;
  @StorageLink('botState') @Watch('onState') state: BotSnapshot = emptyBotSnapshot();

  @State name: string = '';
  @State nameEdited: boolean = false;
  @State suggestedName: string = '新 Bot';
  @State localMode: boolean = false;
  @State agentId: string = '';
  @State chosenCloudModel: string = '';
  @State chosenLocalModel: string = '';
  @State effort: string = '';
  @State lookShape: string = '';
  @State lookColor: string = '';
  @State photo: string = '';
  @State customLook: boolean = false;
  @State createdHandled: boolean = false;
  @State creationRequested: boolean = false;

  @State appearanceOpen: boolean = false;
  @State modelOpen: boolean = false;
  @State libraryOpen: boolean = false;
  @State effortOpen: boolean = false;
  @State draftShape: string = '';
  @State draftColor: string = '';
  @State draftPhoto: string = '';
  @State photoProcessing: boolean = false;
  @State photoError: boolean = false;

  aboutToAppear(): void {
    // 上一轮创建留下的 createdId 属于历史，避免重新进入页面立刻被当成刚创建成功而返回。
    const staleCreated: string = this.state.creation.createdId ?? '';
    this.createdHandled = staleCreated.length > 0;
    this.refreshSuggestedName();
    this.ensureLook();
    if (this.canCreateNow()) {
      this.creationRequested = true;
      BotStore.get().openCreation();
    } else {
      this.requestCreation();
    }
  }

  onState(): void {
    if (!BotStore.get().canCreate()) {
      this.creationRequested = false;
    }
    this.refreshSuggestedName();
    this.ensureLook();
    const created: string = this.state.creation.createdId ?? '';
    if (created.length > 0 && !this.createdHandled) {
      this.createdHandled = true;
      // 成功后返回列表（列表由 botState 自动刷新出新建的 Bot）。
      this.pageStack.pop();
      return;
    }
    this.requestCreation();
  }

  private topInset(): number {
    return this.safeTop > 0 ? this.safeTop : 38.9;
  }

  private saving(): boolean {
    return this.state.creation.saving;
  }

  private canCreateNow(): boolean {
    return BotStore.get().canCreate();
  }

  private requestCreation(): void {
    if (this.creationRequested) {
      return;
    }
    if (!this.canCreateNow()) {
      return;
    }
    if (this.state.creation.appearance !== undefined || this.state.creation.loadingAppearance
      || this.state.creation.appearanceFailed) {
      return;
    }
    this.creationRequested = true;
    BotStore.get().openCreation();
  }

  // ==================== 形象 / 配色 ====================

  private ensureLook(): void {
    const appearance: BotCreationAppearance | undefined = this.state.creation.appearance;
    if (appearance === undefined || this.lookShape.length > 0) {
      return;
    }
    const pair: LookPair = this.randomLook('', '');
    this.lookShape = pair.shape;
    this.lookColor = pair.color;
  }

  private isDullColor(id: string): boolean {
    return DULL_COLORS.indexOf(id) >= 0;
  }

  private randomLook(previousShape: string, previousColor: string): LookPair {
    const appearance: BotCreationAppearance | undefined = this.state.creation.appearance;
    const fallback: LookPair = { shape: previousShape, color: previousColor };
    if (appearance === undefined || appearance.shapes.length === 0) {
      return fallback;
    }
    const shapes: BotCreationShape[] = [];
    for (const one of appearance.shapes) {
      if (one.id === previousShape) {
        continue;
      }
      shapes.push(one);
    }
    if (shapes.length === 0) {
      for (const one of appearance.shapes) {
        shapes.push(one);
      }
    }
    const colors: BotCreationColor[] = [];
    for (const one of appearance.colors) {
      if (this.isDullColor(one.id) || one.id === previousColor) {
        continue;
      }
      colors.push(one);
    }
    if (colors.length === 0) {
      for (const one of appearance.colors) {
        if (this.isDullColor(one.id)) {
          continue;
        }
        colors.push(one);
      }
    }
    if (colors.length === 0) {
      for (const one of appearance.colors) {
        colors.push(one);
      }
    }
    if (colors.length === 0) {
      return fallback;
    }
    const shape: BotCreationShape = shapes[Math.floor(Math.random() * shapes.length)];
    const color: BotCreationColor = colors[Math.floor(Math.random() * colors.length)];
    const result: LookPair = { shape: shape.id, color: color.id };
    return result;
  }

  private colorStops(colorId: string): string[] {
    const appearance: BotCreationAppearance | undefined = this.state.creation.appearance;
    if (appearance === undefined) {
      return ['#888888', '#888888'];
    }
    for (const one of appearance.colors) {
      if (one.id === colorId) {
        if (one.stops.length >= 2) {
          return one.stops;
        }
        if (one.stops.length === 1) {
          return [one.stops[0], one.stops[0]];
        }
        return ['#888888', '#888888'];
      }
    }
    return ['#888888', '#888888'];
  }

  /** 外形 + 配色的预览图（复用 BotStore.creationImage，未知组合返回空串）。 */
  private lookImage(shape: string, color: string): string {
    const value: Object | undefined = BotStore.get().creationImage(shape, color);
    if (typeof value === 'string') {
      return value as string;
    }
    return '';
  }

  private shapeImage(shape: BotCreationShape, colorId: string): string {
    const value: string | undefined = shape.images[colorId];
    return value !== undefined ? value : '';
  }

  private avatarImage(): string {
    if (this.photo.length > 0) {
      return this.photo;
    }
    if (this.localMode && !this.customLook) {
      const agentImage: string = this.agentImage();
      if (agentImage.length > 0) {
        return agentImage;
      }
    }
    return this.lookImage(this.lookShape, this.lookColor);
  }

  private appearanceDescription(): string {
    if (this.localMode && !this.customLook) {
      const title: string = this.agentTitle();
      if (title.length > 0) {
        return '使用 ' + title + ' 形象';
      }
    }
    if (this.customLook) {
      return '使用自定义形象';
    }
    return '使用自动分配的形象';
  }

  private draftPreviewImage(): string {
    if (this.draftPhoto.length > 0) {
      return this.draftPhoto;
    }
    return this.lookImage(this.draftShape, this.draftColor);
  }

  // ==================== 名字 ====================

  private refreshSuggestedName(): void {
    const base: string = '新 Bot';
    const names: string[] = [];
    for (const chat of this.state.chats) {
      if (!chat.room) {
        names.push(chat.name.toLowerCase());
      }
    }
    const lowerBase: string = base.toLowerCase();
    if (names.indexOf(lowerBase) < 0) {
      this.suggestedName = base;
      return;
    }
    let index: number = 2;
    while (names.indexOf(lowerBase + ' ' + index.toString()) >= 0) {
      index += 1;
    }
    this.suggestedName = base + ' ' + index.toString();
  }

  private finalName(): string {
    const typed: string = this.name.trim();
    return typed.length > 0 ? typed : this.suggestedName;
  }

  private nameProblem(): string {
    const value: string = this.finalName();
    if (value.length === 0 || value.length > NAME_LIMIT) {
      return 'length';
    }
    for (let i = 0; i < value.length; i++) {
      const code: number = value.charCodeAt(i);
      if (code === 64 || code === 96 || code < 32 || code === 127) {
        return 'characters';
      }
    }
    const lower: string = value.toLowerCase();
    if (RESERVED_NAMES.indexOf(lower) >= 0) {
      return 'reserved';
    }
    for (const chat of this.state.chats) {
      if (!chat.room && chat.name.toLowerCase() === lower) {
        return 'duplicate';
      }
    }
    return '';
  }

  private nameHelp(problem: string): string {
    if (problem === 'length') {
      return '名字最多 40 个字符。';
    }
    if (problem === 'reserved') {
      return '这个名字在群聊中有保留用途。';
    }
    if (problem === 'duplicate') {
      return '已经有一个同名 Bot。';
    }
    return '名字不能包含 @、反引号或控制字符。';
  }

  private showNameError(): boolean {
    return this.nameEdited && this.nameProblem().length > 0;
  }

  // ==================== 本地 Agent ====================

  private agentOrUndefined(): BotCreationAgent | undefined {
    for (const agent of this.state.creation.agents) {
      if (agent.id === this.agentId && agent.available) {
        return agent;
      }
    }
    return undefined;
  }

  private agentTitle(): string {
    const agent: BotCreationAgent | undefined = this.agentOrUndefined();
    return agent !== undefined ? agent.title : '';
  }

  private agentImage(): string {
    const agent: BotCreationAgent | undefined = this.agentOrUndefined();
    if (agent === undefined || agent.image === undefined) {
      return '';
    }
    return agent.image;
  }

  private agentValue(agent: BotCreationAgent): string {
    if (agent.signedIn === true) {
      return '已登录';
    }
    return agent.available ? '可用' : '未登录';
  }

  // ==================== 模型 ====================

  private isLocalModelRef(ref: string): boolean {
    if (!ref.startsWith('local-')) {
      return false;
    }
    const slash: number = ref.indexOf('/');
    return slash > 'local-'.length && slash < ref.length - 1;
  }

  private cloudModels(): BotRoleOption[] {
    const out: BotRoleOption[] = [];
    for (const option of this.state.models) {
      if (this.isLocalModelRef(option.id)) {
        continue;
      }
      out.push(option);
    }
    return out;
  }

  private defaultCloudModel(): string {
    const models: BotRoleOption[] = this.cloudModels();
    const preferred: string = this.state.defaultModel ?? '';
    if (preferred.length > 0) {
      for (const option of models) {
        if (option.id === preferred) {
          return preferred;
        }
      }
    }
    return models.length > 0 ? models[0].id : '';
  }

  private cloudModelRef(): string {
    if (this.chosenCloudModel.length > 0) {
      return this.chosenCloudModel;
    }
    return this.defaultCloudModel();
  }

  private localDefaultRef(): string {
    const agent: BotCreationAgent | undefined = this.agentOrUndefined();
    return agent !== undefined ? agent.id + '/default' : '';
  }

  private localModelRef(): string {
    if (this.chosenLocalModel.length > 0) {
      return this.chosenLocalModel;
    }
    return this.localDefaultRef();
  }

  private isLocalDefaultSelected(): boolean {
    const fallback: string = this.localDefaultRef();
    return this.chosenLocalModel.length === 0
      || (fallback.length > 0 && this.chosenLocalModel === fallback);
  }

  /** 当前模型展示名；未知 id 保留原值（§7.4 与角色设置同样保留未知 id）。 */
  private modelTitle(): string {
    if (this.localMode) {
      if (this.isLocalDefaultSelected()) {
        return 'CLI 默认';
      }
      for (const option of this.state.creation.agentModels) {
        if (option.id === this.chosenLocalModel) {
          return option.title;
        }
      }
      return this.chosenLocalModel;
    }
    const ref: string = this.cloudModelRef();
    if (ref.length === 0) {
      return '系统默认';
    }
    for (const option of this.cloudModels()) {
      if (option.id === ref) {
        return option.title;
      }
    }
    for (const option of this.state.models) {
      if (option.id === ref) {
        return option.title;
      }
    }
    return ref;
  }

  private localModelHint(): string {
    const title: string = this.agentTitle();
    return title.length > 0 ? '沿用 ' + title + ' 的默认模型。' : '';
  }

  private localModelOptions(): BotRoleOption[] {
    const out: BotRoleOption[] = [];
    for (const option of this.state.creation.agentModels) {
      if (option.id.endsWith('/default')) {
        continue;
      }
      out.push(option);
    }
    return out;
  }

  private effortOptions(): BotRoleOption[] {
    const ref: string = this.cloudModelRef();
    if (ref.length === 0 || this.state.effortModel !== ref) {
      return [];
    }
    return this.state.efforts;
  }

  private effortTitle(): string {
    for (const option of this.state.efforts) {
      if (option.id === this.effort) {
        return option.title;
      }
    }
    return '系统默认';
  }

  // ==================== 提交 ====================

  private createErrorText(): string {
    const error: string = this.state.creation.error ?? '';
    if (error.length === 0) {
      return '';
    }
    if (error === 'uncertain') {
      return '暂时无法确认创建结果，请返回列表查看。';
    }
    return '创建 Bot 失败，请检查主机连接和设置后重试。';
  }

  private unavailableHint(): string {
    if (!this.state.connected) {
      return '连接主机后可以创建 Bot';
    }
    if (!this.state.writable) {
      return '当前主机为只读';
    }
    if (!this.state.supported || !this.state.creation.supported) {
      return '请更新主机上的移动网关和 DS Bot 后再创建 Bot';
    }
    return '';
  }

  /** 可提交条件（§7.2）：canCreateBot、名字无问题、形象已选、本地必须选到可用 Agent、非 uncertain。 */
  private canSubmit(): boolean {
    if (this.state.creation.saving) {
      return false;
    }
    if (!this.canCreateNow()) {
      return false;
    }
    if (this.nameProblem().length > 0) {
      return false;
    }
    if (this.lookShape.length === 0 || this.lookColor.length === 0) {
      return false;
    }
    if (this.localMode && this.agentOrUndefined() === undefined) {
      return false;
    }
    if (this.state.creation.error === 'uncertain') {
      return false;
    }
    return true;
  }

  private submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    const model: string = this.localMode ? this.localModelRef() : this.cloudModelRef();
    const avatarData: string | undefined = this.photo.length > 0 ? this.photo : undefined;
    const effort: string | undefined = (!this.localMode && this.effort.length > 0) ? this.effort : undefined;
    BotStore.get().createBot(this.finalName(), this.lookShape, this.lookColor, avatarData,
      model.length > 0 ? model : undefined, effort, this.localMode && !this.customLook);
  }

  // ==================== 交互 ====================

  private selectMode(local: boolean): void {
    if (this.saving() || this.localMode === local) {
      return;
    }
    this.localMode = local;
    if (local && this.state.creation.agents.length === 0) {
      BotStore.get().loadCreationAgents();
    }
  }

  private selectAgent(agent: BotCreationAgent): void {
    if (this.saving() || !agent.available) {
      return;
    }
    this.agentId = agent.id;
    this.chosenLocalModel = '';
    BotStore.get().loadCreationAgentModels(agent.id);
  }

  private openAppearance(): void {
    if (this.saving()) {
      return;
    }
    if (this.state.creation.appearanceFailed) {
      BotStore.get().openCreation();
      return;
    }
    if (this.state.creation.appearance === undefined) {
      return;
    }
    this.ensureLook();
    this.draftShape = this.lookShape;
    this.draftColor = this.lookColor;
    this.draftPhoto = this.photo;
    this.photoError = false;
    this.libraryOpen = false;
    this.appearanceOpen = true;
  }

  private shuffleDraft(): void {
    const pair: LookPair = this.randomLook(this.draftShape, this.draftColor);
    this.draftShape = pair.shape;
    this.draftColor = pair.color;
    this.draftPhoto = '';
  }

  private commitAppearance(): void {
    if (this.photoProcessing) {
      return;
    }
    if (this.draftShape.length > 0) {
      this.lookShape = this.draftShape;
    }
    if (this.draftColor.length > 0) {
      this.lookColor = this.draftColor;
    }
    this.photo = this.draftPhoto;
    // 对齐 iOS：编辑过形象即视为「自定义形象」，不再沿用 Agent 形象。
    this.customLook = true;
    this.appearanceOpen = false;
    this.libraryOpen = false;
    this.photoError = false;
  }

  private openModel(): void {
    if (this.saving()) {
      return;
    }
    this.effortOpen = false;
    if (!this.localMode) {
      const ref: string = this.cloudModelRef();
      if (ref.length > 0) {
        BotStore.get().loadEfforts(ref);
      }
    }
    this.modelOpen = true;
  }

  private pickCloudModel(id: string): void {
    if (this.cloudModelRef() !== id) {
      this.effort = '';
    }
    this.chosenCloudModel = id;
    this.effortOpen = false;
    BotStore.get().loadEfforts(id);
  }

  private pickLocalModel(id: string, isDefault: boolean): void {
    this.chosenLocalModel = isDefault ? '' : id;
    this.modelOpen = false;
  }

  private toggleEffort(): void {
    if (this.localMode) {
      return;
    }
    if (this.effortOptions().length === 0) {
      const ref: string = this.cloudModelRef();
      if (ref.length > 0) {
        BotStore.get().loadEfforts(ref);
      }
      return;
    }
    this.effortOpen = !this.effortOpen;
  }

  private pickEffort(id: string): void {
    this.effort = id;
    this.effortOpen = false;
  }

  private openLibrary(): void {
    this.libraryOpen = true;
    this.photoError = false;
    if (this.state.creation.photos.length === 0 && !this.state.creation.photosFailed) {
      BotStore.get().loadCreationPhotos(true);
    }
  }

  private retryPhotos(): void {
    BotStore.get().loadCreationPhotos(true);
  }

  private loadMorePhotos(): void {
    if (this.state.creation.loadingPhotos) {
      return;
    }
    BotStore.get().loadCreationPhotos(false);
  }

  private choosePhoto(photo: BotAvatarPhoto): void {
    this.draftPhoto = photo.image;
    this.libraryOpen = false;
  }

  private uploadDraftPhoto(): void {
    if (this.photoProcessing || this.saving()) {
      return;
    }
    this.pickDraftPhoto();
  }

  private async pickDraftPhoto(): Promise<void> {
    this.photoProcessing = true;
    this.photoError = false;
    try {
      const data: string = await pickPhotoDataUrl();
      if (data.length > 0) {
        this.draftPhoto = data;
      }
    } catch (error) {
      this.photoError = true;
    }
    this.photoProcessing = false;
  }

  private importPhoto(): void {
    if (this.photoProcessing) {
      return;
    }
    this.importPickedPhoto();
  }

  private async importPickedPhoto(): Promise<void> {
    this.photoProcessing = true;
    this.photoError = false;
    try {
      const data: string = await pickPhotoDataUrl();
      if (data.length > 0) {
        BotStore.get().importCreationPhoto(data, '导入的照片');
      }
    } catch (error) {
      this.photoError = true;
    }
    this.photoProcessing = false;
  }

  // ==================== 组件 ====================

  @Builder
  header() {
    Row({ space: 10 }) {
      // 统一原生玻璃返回钮（与对话页/设置页一致）
      NavBackButton({ isDark: this.isDark, diameter: 36 })

      Text('新建 Bot')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(ink(this.isDark))
        .layoutWeight(1)
        .textAlign(TextAlign.Center)
        .margin({ right: 4 })

      Column()
        .width(36)
        .height(36)
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: this.topInset() + 6, bottom: 8 })
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  appearanceSection() {
    Row({ space: 12 }) {
      Stack({ alignContent: Alignment.Center }) {
        Column()
          .width(52)
          .height(52)
          .borderRadius(15)
          .backgroundColor(lavenderSoft(this.isDark))
        if (this.avatarImage().length > 0) {
          Image(this.avatarImage())
            .width(52)
            .height(52)
            .borderRadius(15)
            .objectFit(ImageFit.Cover)
        }
      }
      .width(52)
      .height(52)

      Column({ space: 4 }) {
        Text('形象')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(ink(this.isDark))
          .width('100%')
        Text(this.appearanceDescription())
          .fontSize(12)
          .fontColor(secondary(this.isDark))
          .width('100%')
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      if (this.state.creation.loadingAppearance) {
        LoadingProgress()
          .width(20)
          .height(20)
          .color(this.actionColor())
      } else {
        Text(this.state.creation.appearanceFailed ? '重试' : '编辑')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.actionColor())
        Text('›')
          .fontSize(18)
          .fontColor(secondary(this.isDark))
          .opacity(0.7)
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 84 })
    .padding({ left: 16, right: 14, top: 12, bottom: 12 })
    .alignItems(VerticalAlign.Center)
    .borderRadius(20)
    .backgroundColor(card(this.isDark))
    .border({ width: 0.7, color: this.isDark ? RIM_DARK : Color.Transparent })
    .shadow({ radius: 16, color: this.isDark ? 'rgba(0,0,0,0.35)' : 'rgba(37,35,50,0.06)', offsetX: 0, offsetY: 8 })
    .opacity(this.canCreateNow() || this.state.creation.appearanceFailed ? 1 : 0.56)
    .onClick(() => {
      this.openAppearance();
    })
  }

  @Builder
  nameSection() {
    Column({ space: 8 }) {
      Text('名字')
        .fontSize(13)
        .fontColor(secondary(this.isDark))
        .width('100%')
      TextInput({ text: this.name, placeholder: this.suggestedName })
        .fontSize(16)
        .fontColor(ink(this.isDark))
        .placeholderColor(secondary(this.isDark))
        .caretColor(purple(this.isDark))
        .height(52)
        .padding({ left: 16, right: 16 })
        .backgroundColor(card(this.isDark))
        .borderRadius(16)
        .border({ width: 1, color: line(this.isDark) })
        .enabled(!this.saving())
        .onChange((value: string) => {
          this.name = value;
          this.nameEdited = true;
        })
      if (this.showNameError()) {
        Text(this.nameHelp(this.nameProblem()))
          .fontSize(13)
          .fontColor(DANGER)
          .width('100%')
      } else {
        Text('留空会使用自动生成的名字。')
          .fontSize(13)
          .fontColor(secondary(this.isDark))
          .width('100%')
      }
    }
    .width('100%')
  }

  @Builder
  modeSection() {
    Column({ space: 8 }) {
      Text('运行方式')
        .fontSize(13)
        .fontColor(secondary(this.isDark))
        .width('100%')
      Row() {
        Row() {
          Text('DS Bot 模型')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.localMode ? secondary(this.isDark) : ink(this.isDark))
        }
        .layoutWeight(1)
        .height(34)
        .borderRadius(9)
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        .backgroundColor(this.localMode ? Color.Transparent : this.segmentSelectedColor())
        .onClick(() => {
          this.selectMode(false);
        })

        Row() {
          Text('本地 Agent')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.localMode ? ink(this.isDark) : secondary(this.isDark))
        }
        .layoutWeight(1)
        .height(34)
        .borderRadius(9)
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        .backgroundColor(this.localMode ? this.segmentSelectedColor() : Color.Transparent)
        .onClick(() => {
          this.selectMode(true);
        })
      }
      .width('100%')
      .padding(3)
      .borderRadius(12)
      .backgroundColor(this.isDark ? this.palette().baseDark : this.palette().gridDot.replace(/,\s*[\d.]+\)$/, ',0.16)'))
      .border({ width: 0.7, color: this.isDark ? RIM_DARK : line(this.isDark) })
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
  }

  @Builder
  agentSection() {
    Column({ space: 8 }) {
      Text('本地 Agent')
        .fontSize(13)
        .fontColor(secondary(this.isDark))
        .width('100%')
      if (this.state.creation.loadingAgents && this.state.creation.agents.length === 0) {
        Column() {
          LoadingProgress()
            .width(24)
            .height(24)
            .color(this.actionColor())
        }
        .width('100%')
        .padding(16)
        .borderRadius(20)
        .backgroundColor(card(this.isDark))
        .border({ width: 0.7, color: this.isDark ? RIM_DARK : Color.Transparent })
        .alignItems(HorizontalAlign.Center)
      } else if (this.state.creation.agentsFailed || this.state.creation.agents.length === 0) {
        Row({ space: 6 }) {
          Text(this.state.creation.agentsFailed ? '无法读取本地 Agent' : '未发现本地 Agent')
            .fontSize(15)
            .fontColor(ink(this.isDark))
            .layoutWeight(1)
          Text('重试')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.actionColor())
        }
        .width('100%')
        .constraintSize({ minHeight: 52 })
        .padding({ left: 16, right: 14 })
        .alignItems(VerticalAlign.Center)
        .borderRadius(20)
        .backgroundColor(card(this.isDark))
        .border({ width: 0.7, color: this.isDark ? RIM_DARK : Color.Transparent })
        .onClick(() => {
          BotStore.get().loadCreationAgents();
        })
      } else {
        Column() {
          ForEach(this.state.creation.agents, (agent: BotCreationAgent, index: number) => {
            this.agentRow(agent, index === this.state.creation.agents.length - 1)
          }, (agent: BotCreationAgent) => agent.id + ':' + (agent.available ? '1' : '0'))
        }
        .width('100%')
        .borderRadius(20)
        .backgroundColor(card(this.isDark))
        .border({ width: 0.7, color: this.isDark ? RIM_DARK : Color.Transparent })
        .clip(true)
      }
      if (this.agentOrUndefined() === undefined) {
        Text('请选择主机上可用的 Agent。')
          .fontSize(13)
          .fontColor(secondary(this.isDark))
          .width('100%')
      }
    }
    .width('100%')
  }

  @Builder
  agentRow(agent: BotCreationAgent, last: boolean) {
    Column() {
      Row({ space: 10 }) {
        Text('>_')
          .fontSize(11)
          .fontColor(secondary(this.isDark))
        Text(agent.title)
          .fontSize(15)
          .fontColor(ink(this.isDark))
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.agentValue(agent))
          .fontSize(13)
          .fontColor(secondary(this.isDark))
        if (this.agentId === agent.id) {
          Text('✓')
            .fontSize(15)
            .fontColor(this.actionColor())
        }
      }
      .width('100%')
      .constraintSize({ minHeight: 52 })
      .padding({ left: 16, right: 16 })
      .alignItems(VerticalAlign.Center)
      .opacity(agent.available ? 1 : 0.56)
      .onClick(() => {
        this.selectAgent(agent);
      })

      if (!last) {
        Column()
          .width('100%')
          .height(0.6)
          .backgroundColor(line(this.isDark))
          .opacity(0.45)
          .margin({ left: 16 })
      }
    }
    .width('100%')
  }

  @Builder
  modelSection() {
    Column({ space: 8 }) {
      Text('模型')
        .fontSize(13)
        .fontColor(secondary(this.isDark))
        .width('100%')
      Row({ space: 8 }) {
        Text(this.localMode ? '模型' : '所选模型')
          .fontSize(15)
          .fontColor(ink(this.isDark))
        Blank()
        Text(this.modelTitle())
          .fontSize(13)
          .fontColor(secondary(this.isDark))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: '58%' })
          .textAlign(TextAlign.End)
        Text('›')
          .fontSize(18)
          .fontColor(secondary(this.isDark))
          .opacity(0.7)
      }
      .width('100%')
      .constraintSize({ minHeight: 52 })
      .padding({ left: 16, right: 14 })
      .alignItems(VerticalAlign.Center)
      .borderRadius(20)
      .backgroundColor(card(this.isDark))
      .border({ width: 0.7, color: this.isDark ? RIM_DARK : Color.Transparent })
      .onClick(() => {
        this.openModel();
      })

      if (this.localMode) {
        Text(this.localModelHint())
          .fontSize(13)
          .fontColor(secondary(this.isDark))
          .width('100%')
      } else {
        Text('沿用主机预选模型，可在 Bot 详情中修改。')
          .fontSize(13)
          .fontColor(secondary(this.isDark))
          .width('100%')
      }
    }
    .width('100%')
  }

  @Builder
  footer() {
    Column() {
      Button() {
        if (this.saving()) {
          LoadingProgress()
            .width(24)
            .height(24)
            .color('#FFFFFF')
        } else {
          Text('创建 Bot')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor('#FFFFFF')
        }
      }
      .width('100%')
      .height(50)
      .borderRadius(25)
      .backgroundColor(this.actionColor())
      .enabled(this.canSubmit())
      .opacity(this.canSubmit() ? 1 : 0.45)
      .onClick(() => {
        this.submit();
      })
    }
    .width('100%')
    .padding({ left: 24, right: 24, top: 8, bottom: 12 + this.safeBottom })
  }

  // ==================== 形象面板（编辑形象 / 头像库） ====================

  @Builder
  appearanceSheetHeader() {
    Row({ space: 10 }) {
      NavBackButton({ isDark: this.isDark, diameter: 36, onBack: () => {
        if (this.libraryOpen) {
          this.libraryOpen = false;
        } else {
          this.appearanceOpen = false;
        }
      } })

      Text(this.libraryOpen ? '头像库' : '编辑形象')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(ink(this.isDark))
        .layoutWeight(1)
        .textAlign(TextAlign.Center)
        .margin({ right: 4 })

      if (this.libraryOpen) {
        Row() {
          Text('导入照片')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.actionColor())
        }
        .height(34)
        .padding({ left: 12, right: 12 })
        .borderRadius(17)
        .backgroundColor(card(this.isDark))
        .border({ width: 0.7, color: this.isDark ? RIM_DARK : line(this.isDark) })
        .opacity(this.photoProcessing ? 0.45 : 1)
        .onClick(() => {
          this.importPhoto();
        })
      } else {
        Column()
          .width(36)
          .height(36)
      }
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 12, bottom: 8 })
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  appearanceBody() {
    Column({ space: 16 }) {
      Column() {
        if (this.draftPreviewImage().length > 0) {
          Image(this.draftPreviewImage())
            .width(72)
            .height(72)
            .borderRadius(24)
            .objectFit(ImageFit.Cover)
        } else {
          Column()
            .width(72)
            .height(72)
            .borderRadius(24)
            .backgroundColor(lavenderSoft(this.isDark))
        }
      }
      .width('100%')
      .constraintSize({ minHeight: 84 })
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .borderRadius(20)
      .backgroundColor(card(this.isDark))

      if (this.state.creation.appearance !== undefined) {
        Column({ space: 8 }) {
          Text('形状')
            .fontSize(13)
            .fontColor(secondary(this.isDark))
            .width('100%')
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
            ForEach(this.state.creation.appearance.shapes, (item: BotCreationShape) => {
              Column() {
                if (this.shapeImage(item, this.draftColor).length > 0) {
                  Image(this.shapeImage(item, this.draftColor))
                    .width(40)
                    .height(40)
                    .objectFit(ImageFit.Contain)
                }
              }
              .width('19%')
              .height(52)
              .justifyContent(FlexAlign.Center)
              .borderRadius(14)
              .backgroundColor(this.lookTileColor(this.draftPhoto.length === 0 && this.draftShape === item.id))
              .border({
                width: this.draftPhoto.length === 0 && this.draftShape === item.id ? 1.5 : 0,
                color: this.actionColor()
              })
              .margin({ bottom: 8 })
              .onClick(() => {
                this.draftShape = item.id;
                this.draftPhoto = '';
              })
            }, (item: BotCreationShape) => item.id)
          }
          .width('100%')
        }
        .width('100%')

        Column({ space: 8 }) {
          Text('颜色')
            .fontSize(13)
            .fontColor(secondary(this.isDark))
            .width('100%')
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.state.creation.appearance.colors, (item: BotCreationColor) => {
              Column() {
                Row()
                  .width(31)
                  .height(31)
                  .borderRadius(16)
                  .linearGradient({
                    angle: 135,
                    colors: [[this.colorStops(item.id)[0], 0], [this.colorStops(item.id)[1], 1]]
                  })
                  .border({
                    width: this.draftPhoto.length === 0 && this.draftColor === item.id ? 2 : 0.75,
                    color: this.draftPhoto.length === 0 && this.draftColor === item.id ? this.actionColor() : '#FFFFFF'
                  })
              }
              .width(37)
              .height(38)
              .justifyContent(FlexAlign.Center)
              .margin({ right: 10, bottom: 2 })
              .onClick(() => {
                this.draftColor = item.id;
                this.draftPhoto = '';
              })
            }, (item: BotCreationColor) => item.id)
          }
          .width('100%')
        }
        .width('100%')
      }

      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
        Row() {
          Text('随机')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.actionColor())
        }
        .height(40)
        .padding({ left: 14, right: 14 })
        .borderRadius(20)
        .backgroundColor(card(this.isDark))
        .border({ width: 0.7, color: this.isDark ? RIM_DARK : line(this.isDark) })
        .margin({ right: 8, bottom: 8 })
        .onClick(() => {
          this.shuffleDraft();
        })

        Row() {
          Text(this.photoProcessing ? '处理中…' : '上传照片')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.actionColor())
        }
        .height(40)
        .padding({ left: 14, right: 14 })
        .borderRadius(20)
        .backgroundColor(card(this.isDark))
        .border({ width: 0.7, color: this.isDark ? RIM_DARK : line(this.isDark) })
        .margin({ right: 8, bottom: 8 })
        .opacity(this.photoProcessing ? 0.45 : 1)
        .onClick(() => {
          this.uploadDraftPhoto();
        })

        Row() {
          Text('头像库')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.actionColor())
        }
        .height(40)
        .padding({ left: 14, right: 14 })
        .borderRadius(20)
        .backgroundColor(card(this.isDark))
        .border({ width: 0.7, color: this.isDark ? RIM_DARK : line(this.isDark) })
        .margin({ right: 8, bottom: 8 })
        .onClick(() => {
          this.openLibrary();
        })
      }
      .width('100%')

      if (this.photoError) {
        Text('无法读取或处理所选照片。')
          .fontSize(13)
          .fontColor(DANGER)
          .width('100%')
      }
    }
    .width('100%')
  }

  @Builder
  libraryBody() {
    Column({ space: 12 }) {
      if (this.state.creation.loadingPhotos && this.state.creation.photos.length === 0) {
        Column() {
          LoadingProgress()
            .width(24)
            .height(24)
            .color(this.actionColor())
        }
        .width('100%')
        .padding(20)
        .borderRadius(20)
        .backgroundColor(card(this.isDark))
        .alignItems(HorizontalAlign.Center)
      } else if (this.state.creation.photosFailed) {
        Row({ space: 6 }) {
          Text('头像库操作失败')
            .fontSize(15)
            .fontColor(ink(this.isDark))
            .layoutWeight(1)
          Text('重试')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.actionColor())
        }
        .width('100%')
        .constraintSize({ minHeight: 52 })
        .padding({ left: 16, right: 14 })
        .alignItems(VerticalAlign.Center)
        .borderRadius(20)
        .backgroundColor(card(this.isDark))
        .onClick(() => {
          this.retryPhotos();
        })
      } else if (this.state.creation.photos.length === 0) {
        Text('头像库还没有照片。')
          .fontSize(13)
          .fontColor(secondary(this.isDark))
          .width('100%')
          .padding({ top: 12, bottom: 12 })
      } else {
        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
          ForEach(this.state.creation.photos, (photo: BotAvatarPhoto) => {
            Column() {
              Image(photo.image)
                .width(64)
                .height(64)
                .borderRadius(20)
                .objectFit(ImageFit.Cover)
            }
            .width(72)
            .height(72)
            .justifyContent(FlexAlign.Center)
            .borderRadius(20)
            .backgroundColor(card(this.isDark))
            .border({ width: this.draftPhoto === photo.image ? 2 : 0, color: this.actionColor() })
            .margin({ right: 10, bottom: 10 })
            .onClick(() => {
              this.choosePhoto(photo);
            })
          }, (photo: BotAvatarPhoto) => photo.id)
        }
        .width('100%')

        if (this.state.creation.hasMorePhotos) {
          Row() {
            if (this.state.creation.loadingPhotos) {
              LoadingProgress()
                .width(18)
                .height(18)
                .color(this.actionColor())
            } else {
              Text('加载更多')
                .fontSize(13)
                .fontColor(secondary(this.isDark))
            }
          }
          .width('100%')
          .height(44)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          .borderRadius(16)
          .backgroundColor(card(this.isDark))
          .onClick(() => {
            this.loadMorePhotos();
          })
        }
      }

      if (this.photoError) {
        Text('无法读取或处理所选照片。')
          .fontSize(13)
          .fontColor(DANGER)
          .width('100%')
      }
    }
    .width('100%')
  }

  @Builder
  appearanceSheet() {
    Column() {
      this.appearanceSheetHeader()

      Scroll() {
        Column({ space: 16 }) {
          if (this.libraryOpen) {
            this.libraryBody()
          } else {
            this.appearanceBody()
          }
        }
        .width('100%')
        .padding({ left: 24, right: 24, top: 8, bottom: 16 })
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
      .align(Alignment.Top)

      if (!this.libraryOpen) {
        Column() {
          Button() {
            Text('完成')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .fontColor('#FFFFFF')
          }
          .width('100%')
          .height(50)
          .borderRadius(25)
          .backgroundColor(this.actionColor())
          .enabled(!this.photoProcessing)
          .opacity(this.photoProcessing ? 0.45 : 1)
          .onClick(() => {
            this.commitAppearance();
          })
        }
        .width('100%')
        .padding({ left: 24, right: 24, top: 8, bottom: 12 + this.safeBottom })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.canvasColor())
  }

  // ==================== 模型选择面板 ====================

  @Builder
  modelSheetRow(title: string, id: string, selected: boolean, isDefault: boolean) {
    Row({ space: 8 }) {
      Text(title)
        .fontSize(15)
        .fontColor(ink(this.isDark))
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (selected) {
        Text('已选')
          .fontSize(13)
          .fontColor(this.actionColor())
      } else {
        Text('选择')
          .fontSize(13)
          .fontColor(secondary(this.isDark))
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 52 })
    .padding({ left: 16, right: 16 })
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      if (this.localMode) {
        this.pickLocalModel(id, isDefault);
      } else {
        this.pickCloudModel(id);
      }
    })
  }

  @Builder
  effortRow(title: string, id: string, selected: boolean) {
    Row({ space: 8 }) {
      Text(title)
        .fontSize(15)
        .fontColor(ink(this.isDark))
        .layoutWeight(1)
      if (selected) {
        Text('已选')
          .fontSize(13)
          .fontColor(this.actionColor())
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 48 })
    .padding({ left: 16, right: 16 })
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.pickEffort(id);
    })
  }

  @Builder
  modelSheet() {
    Column() {
      Row({ space: 10 }) {
        Button({ type: ButtonType.Circle }) {
          Text('‹')
            .fontSize(24)
            .fontColor(ink(this.isDark))
            .offset({ y: -1 })
        }
        .width(36)
        .height(36)
        .backgroundColor(lavenderSoft(this.isDark))
        .onClick(() => {
          this.modelOpen = false;
        })

        Text('选择模型')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(ink(this.isDark))
          .layoutWeight(1)
          .textAlign(TextAlign.Center)

        Column()
          .width(36)
          .height(36)
      }
      .width('100%')
      .padding({ left: 14, right: 14, top: 12, bottom: 8 })
      .alignItems(VerticalAlign.Center)

      Scroll() {
        Column({ space: 16 }) {
          Text('可用模型')
            .fontSize(13)
            .fontColor(secondary(this.isDark))
            .width('100%')

          Column() {
            if (this.localMode) {
              this.modelSheetRow('CLI 默认', this.localDefaultRef(), this.isLocalDefaultSelected(), true)
              ForEach(this.localModelOptions(), (option: BotRoleOption) => {
                this.modelSheetRow(option.title, option.id, this.chosenLocalModel === option.id, false)
              }, (option: BotRoleOption) => option.id)
              if (this.state.creation.loadingAgentModels) {
                Column() {
                  LoadingProgress()
                    .width(20)
                    .height(20)
                    .color(this.actionColor())
                }
                .width('100%')
                .padding(10)
                .alignItems(HorizontalAlign.Center)
              }
              if (!this.state.creation.loadingAgentModels && this.state.creation.agentModels.length === 0) {
                Text('这个 Agent 没有可选的模型，将沿用 CLI 默认。')
                  .fontSize(13)
                  .fontColor(secondary(this.isDark))
                  .width('100%')
                  .padding({ left: 16, right: 16, top: 4, bottom: 12 })
              }
            } else {
              ForEach(this.cloudModels(), (option: BotRoleOption) => {
                this.modelSheetRow(option.title, option.id, this.cloudModelRef() === option.id, false)
              }, (option: BotRoleOption) => option.id)
              if (this.cloudModels().length === 0) {
                Text('主机暂无可选模型')
                  .fontSize(13)
                  .fontColor(secondary(this.isDark))
                  .width('100%')
                  .padding(16)
              }
            }
          }
          .width('100%')
          .borderRadius(20)
          .backgroundColor(card(this.isDark))
          .border({ width: 0.7, color: this.isDark ? RIM_DARK : Color.Transparent })
          .clip(true)

          if (!this.localMode) {
            Text('思考强度')
              .fontSize(13)
              .fontColor(secondary(this.isDark))
              .width('100%')

            Column() {
              Row({ space: 8 }) {
                Text('思考强度')
                  .fontSize(15)
                  .fontColor(ink(this.isDark))
                Blank()
                Text(this.effortTitle())
                  .fontSize(13)
                  .fontColor(secondary(this.isDark))
                Text(this.effortOpen ? '⌃' : '⌄')
                  .fontSize(12)
                  .fontColor(secondary(this.isDark))
              }
              .width('100%')
              .constraintSize({ minHeight: 52 })
              .padding({ left: 16, right: 14 })
              .alignItems(VerticalAlign.Center)
              .onClick(() => {
                this.toggleEffort();
              })

              if (this.effortOpen) {
                Column()
                  .width('100%')
                  .height(0.6)
                  .backgroundColor(line(this.isDark))
                  .opacity(0.45)
                  .margin({ left: 16 })

                this.effortRow('系统默认', '', this.effort.length === 0)

                ForEach(this.effortOptions(), (option: BotRoleOption) => {
                  this.effortRow(option.title, option.id, this.effort === option.id)
                }, (option: BotRoleOption) => option.id)
              }
            }
            .width('100%')
            .borderRadius(20)
            .backgroundColor(card(this.isDark))
            .border({ width: 0.7, color: this.isDark ? RIM_DARK : Color.Transparent })
            .clip(true)

            Text('主机会提供模型和它所支持的思考强度。')
              .fontSize(13)
              .fontColor(secondary(this.isDark))
              .width('100%')
          }
        }
        .width('100%')
        .padding({ left: 24, right: 24, top: 8, bottom: 16 })
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%')
    .height('100%')
    .padding({ bottom: this.safeBottom })
    .backgroundColor(this.canvasColor())
  }

  build() {
    NavDestination() {
      Column() {
        this.header()

        Scroll() {
          Column({ space: 16 }) {
            this.appearanceSection()
            this.nameSection()
            this.modeSection()
            if (this.localMode) {
              this.agentSection()
            }
            if (!this.localMode || this.agentOrUndefined() !== undefined) {
              this.modelSection()
            }
            if (this.createErrorText().length > 0) {
              Text(this.createErrorText())
                .fontSize(13)
                .fontColor(DANGER)
                .width('100%')
            }
            if (this.unavailableHint().length > 0) {
              Text(this.unavailableHint())
                .fontSize(13)
                .fontColor(secondary(this.isDark))
                .width('100%')
            }
          }
          .width('100%')
          .padding({ left: 24, right: 24, top: 8, bottom: 16 })
          .alignItems(HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Off)
        .align(Alignment.Top)

        this.footer()

        Column()
          .width(1)
          .height(1)
          .opacity(0.01)
          .bindSheet($$this.appearanceOpen, this.appearanceSheet(), {
            height: '88%',
            dragBar: false,
            showClose: false,
            preferType: SheetType.BOTTOM,
            backgroundColor: this.canvasColor(),
            onDisappear: () => {
              this.libraryOpen = false;
              this.photoError = false;
            }
          })

        Column()
          .width(1)
          .height(1)
          .opacity(0.01)
          .bindSheet($$this.modelOpen, this.modelSheet(), {
            height: '82%',
            dragBar: false,
            showClose: false,
            preferType: SheetType.BOTTOM,
            backgroundColor: this.canvasColor()
          })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.canvasColor())
    }
    .hideTitleBar(true)
  }
}

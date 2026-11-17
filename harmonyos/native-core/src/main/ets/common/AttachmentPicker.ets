import { common } from '@kit.AbilityKit';
import { picker } from '@kit.CoreFileKit';

export interface PickedAttachment {
  uri: string;
  name: string;
}

/** Opens the HarmonyOS document picker. The returned URI requires caller-side transfer handling. */
export async function pickDocuments(context: common.UIAbilityContext, maxSelectNumber: number = 4): Promise<PickedAttachment[]> {
  const viewPicker = new picker.DocumentViewPicker(context);
  const options = new picker.DocumentSelectOptions();
  options.maxSelectNumber = maxSelectNumber;
  options.selectMode = picker.DocumentSelectMode.FILE;
  options.fileSuffixFilters = ['All files (*.*)|.*'];
  const uris: string[] = await viewPicker.select(options);
  const result: PickedAttachment[] = [];
  for (const uri of uris) {
    const item: PickedAttachment = { uri: uri, name: uri.substring(uri.lastIndexOf('/') + 1) || '附件' };
    result.push(item);
  }
  return result;
}

import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { image } from '@kit.ImageKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { ConnectorAdapter } from './DeviceConnectors';
import { Logger } from '../common/Logger';

interface PhotoImage {
  mediaType: string;
  width: number;
  height: number;
  data: string;
}

interface PhotoResult {
  images: PhotoImage[];
}

class PhotosConnector implements ConnectorAdapter {
  id: string = 'photos';

  available(): boolean {
    return true;
  }

  async authorize(): Promise<boolean> {
    return true;
  }

  private async compress(pixelMap: image.PixelMap): Promise<ArrayBuffer> {
    const packer: image.ImagePacker = image.createImagePacker();
    let quality: number = 80;
    let buffer: ArrayBuffer = await packer.packing(pixelMap, { format: 'image/jpeg', quality: quality });
    while (buffer.byteLength > 65536 && quality > 20) {
      quality -= 15;
      buffer = await packer.packing(pixelMap, { format: 'image/jpeg', quality: quality });
    }
    await packer.release();
    return buffer;
  }

  private async select(): Promise<PhotoResult> {
    const picker: photoAccessHelper.PhotoViewPicker = new photoAccessHelper.PhotoViewPicker();
    const options: photoAccessHelper.PhotoSelectOptions = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    options.maxSelectNumber = 1;
    const selected: photoAccessHelper.PhotoSelectResult = await picker.select(options);
    if (selected.photoUris.length === 0) {
      throw new Error('no_photo');
    }
    const file = fs.openSync(selected.photoUris[0], fs.OpenMode.READ_ONLY);
    const source: image.ImageSource = image.createImageSource(file.fd);
    const info: image.ImageInfo = await source.getImageInfo();
    let width: number = info.size.width;
    let height: number = info.size.height;
    const maxSide: number = Math.max(width, height);
    if (maxSide > 768) {
      const scale: number = 768 / maxSide;
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
    }
    const pixelMap: image.PixelMap = await source.createPixelMap({
      desiredSize: { width: width, height: height }
    });
    const buffer: ArrayBuffer = await this.compress(pixelMap);
    const helper: util.Base64Helper = new util.Base64Helper();
    const data: string = helper.encodeToStringSync(new Uint8Array(buffer));
    fs.closeSync(file);
    await pixelMap.release();
    await source.release();
    return {
      images: [{ mediaType: 'image/jpeg', width: width, height: height, data: data }]
    };
  }

  async invoke(tool: string, args: Record<string, Object>): Promise<Object> {
    if (tool === 'photos.select') {
      return await this.select() as Object;
    }
    throw new Error('tool_unsupported');
  }

  cancel(invocationId: string): void {
  }
}

export const photosConnector: PhotosConnector = new PhotosConnector();

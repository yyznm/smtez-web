const BASE = 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image'

export type ImageSize =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9'

export function textToImage(prompt: string, imageSize: ImageSize = 'square_hd'): string {
  return `${BASE}?prompt=${encodeURIComponent(prompt)}&image_size=${imageSize}`
}

/**
 * 相机取像。真机接入时替换为 MJPEG / WebRTC 流地址即可，
 * 这里使用机台视觉示意的静态画面。
 */
export const cameraFeed = {
  /** 吸嘴取料画面（顶部相机 / 元件相机） */
  nozzle: textToImage(
    'macro photograph through an industrial machine vision lens of a vacuum nozzle tip holding a tiny SMD electronic component, viewed from below, dark metallic background, circular lens vignette, cool blue rim light, shallow depth of field, high detail, no text',
    'landscape_4_3',
  ),
  /** PCB 焊盘画面（底部相机 / 角度相机） */
  pad: textToImage(
    'top down macro photograph of a PCB solder pad with a placed SMD resistor under a machine vision camera, dark green board, circular white ring illumination, sharp detail, industrial inspection lighting, no text',
    'square_hd',
  ),
}

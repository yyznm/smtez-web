/** 运动轴：x / y 为头部，z·r 各对应两个吸嘴 */
export type AxisKey = 'x' | 'y' | 'z1' | 'z2' | 'r1' | 'r2'

/** 点动轴 */
export type JogAxis = 'x' | 'y' | 'z' | 'r'

/** 相机宫格布局 */
export type GridLayout = '1x1' | '2x2' | '3x3'

/** 总览曲线采样点 */
export interface SpeedSample {
  /** 时间（秒） */
  t: number
  /** 进度 % */
  progress: number
  /** 速度 mm/s */
  speed: number
  /** 抛料次数 */
  reject: number
}

# 谱面文件格式

Liquid Rhythm 的谱面以 **JSON** 存储，扩展名建议 `.lrchart.json`。
编辑器的「导出谱面 / 导入谱面」用的就是这个格式，方便你备份、分享或写第三方工具。

## 结构

```json
{
  "format": "liquid-rhythm-chart",
  "version": 1,
  "song": "One Last Kiss",
  "mode": "fall",
  "diff": "hard",
  "lanes": 4,
  "bpm": 128,
  "beat": 0.46875,
  "offset": 0.15,
  "duration": 32.4,
  "notes": [
    { "t": 1.406, "lane": 0, "dur": 0 },
    { "t": 1.875, "lane": 3, "dur": 0.937 }
  ]
}
```

## 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `format` | string | 固定为 `"liquid-rhythm-chart"`，用来认出这是本项目的谱面 |
| `version` | number | 格式版本，当前为 `1` |
| `song` | string | 曲名，仅作显示与提示用 |
| `mode` | string | `"fall"` 下落式 / `"side"` 横向 / `"rd"` 节奏医生式 |
| `diff` | string | `"easy"` / `"normal"` / `"hard"` / `"expert"` |
| `lanes` | number | 轨道数，1~8。下落式一般 4 或 6，横向固定 2，节奏医生式固定 1 |
| `bpm` | number | 每分钟拍数 |
| `beat` | number | 一拍的秒数，即 `60 / bpm` |
| `offset` | number | 第一拍所在的时间（秒）。用于把网格对齐到音乐 |
| `duration` | number | 曲目总时长（秒） |
| `notes` | array | 音符数组，见下 |

## 音符

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `t` | number | 命中时间，**单位是秒**（不是拍） |
| `lane` | number | 轨道下标，从 `0` 开始，必须小于 `lanes` |
| `dur` | number | 长按时长（秒）。`0` 或不写 = 单击音符；`> 0.05` = 长按 |

> `t` 用秒而不是拍，是为了避免 BPM 变化或浮点舍入带来的累计误差。
> 精度上三位小数（毫秒级）足够。

## 导入时的校验

编辑器不会盲信文件内容。`validate()` 会逐条检查，遇到坏数据直接拒绝并告诉你第几条出错：

- 顶层必须是对象，`notes` 必须是**非空数组**
- `format` 如果存在，必须等于 `"liquid-rhythm-chart"`
- 每个音符的 `t` 必须是**有限的非负数**
- 每个音符的 `lane` 必须是整数且 `0 <= lane < lanes`
- `dur` 非法时归零（不报错，退化成单击）
- 校验通过后按 `t` 再按 `lane` 排序

## 手写谱面的注意事项

1. **`beat` 要和 `bpm` 对得上**，否则编辑器的网格会错位：`beat = 60 / bpm`
2. **`offset` 决定网格原点**。如果 `offset` 是 0 但音乐第一拍在 0.15 秒，网格就会整体偏半格
3. **一个位置不要放两个音符**（同一 `t` 同一 `lane`）。游戏不会崩，但那是无意义的重复
4. 音符**不要求**落在网格上——编辑器吸附只是为了方便，导入不做网格检查

## 最小可用示例

4 轨、120 BPM、每拍一个音符轮流走四轨：

```json
{
  "format": "liquid-rhythm-chart",
  "version": 1,
  "mode": "fall",
  "diff": "normal",
  "lanes": 4,
  "bpm": 120,
  "beat": 0.5,
  "offset": 0,
  "duration": 10,
  "notes": [
    { "t": 1.0, "lane": 0, "dur": 0 },
    { "t": 1.5, "lane": 1, "dur": 0 },
    { "t": 2.0, "lane": 2, "dur": 0 },
    { "t": 2.5, "lane": 3, "dur": 0 }
  ]
}
```

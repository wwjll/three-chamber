
# DH 参数建模
1. 现在在 Controls 控制界面增加一个 folder 叫做 Base, 下面有 MDH mod 可勾选选项，勾选后使用 mdh 模式生成，目前默认为不勾选，使用传统 DH 方法
2. 在 Base 下增加 Offset 子目录，可设置 x, y, z 三个方向对于首关节的偏移
3. 现在在 传统 DH 方法模式下，使用这样的生成逻辑：
    - 在原点关于上面一步 offset 的位置作为原点，首先会生成一个关节 Joint，它的 Frame（坐标）为默认，然后根据第一组 DH 参数来生成弯折连接，此时下一个 Joint 的 Frame 和位置发生了改变，显然是在弯折末端，根据新的 Frame 生成 Joint，然后应用第二组参数生成第二个连接，依次类推
4. 按照新方法删除之前冗余的改动，现在的方法应该有自然的弯折过渡，现在依据  { theta: 0, d: 0.5, a: 1, alpha: 90, thetaOffset: 0 } 这样一组参数生成路径的三个点分别为上一个连接的起点 A 点，沿着 Z 轴移动 d(0.5) 为 B 点, 然后旋转 x 轴 alpha（90°），沿着 x 轴延长 a(1) 长度到达 C 点。


# 参数转换
在 Utils.js 里写一个方法叫做 `ConvertMDH(params)`, 该方法接收一组传统 dh 参数并将结果转换成 MDH 参数，规则如下：

- DH 参数如果有 n 组，那么 MDH 参数则有 n + 1 组
- 从 DH 参数的第一组开始，a 和 alpha 以此往下移动，也就是说第 n + 1 组的 MDH 参数的 a 和 alpha 是第 n 组的 DH 参数的 a 和 alpha
- 移动 a 和 alpha 后，第一组 DH 参数的 a 和 alpha 设置为 0
- MDH 参数的最后一组 theta 和 d 设置为 0
- 新生成的 minAngle 和 maxAngle 保持不变，新增加的 n + 1 组的 minAngle 和 maxAngle 使用默认值 -185 和 185
- 同时写另一个的方法 `ConvertDH(params)`，它把 MDH 参数组转化为 DH 参数组，一组 DH 参数经过这两个方法转换后值应该是一样的，你用 presets 里的这几组参数来测试验证下

# MDH 参数建模

勾选 MDH mode 后使用 MDH 建模方法，会使用 `ConvertMDH(params)` 来把传统 DH 参数进行转换并使用，同时构建顺序有些许不同，特点如下：
- 第一个 frame 建立在原点位置，这个 frame 会应用 Base 的 Offset, 第一个 frame 没有建立关节
- 第一个 Joint 的 frame 是第一组参数确定的，比如 { theta: 0, d: 0.5, a: 0, alpha: 0, thetaOffset: 0 } 是在第一个 frame 的基础上沿着 frame 的 z 轴移动到 d(0.5) 的位置
- 第一个 frame 和 第一个 Joint 之间先不用有任何连接，第一个 frame 的地方仅仅在 show axis helper 的情况下会显示坐标轴
- 依此类推，和传统 DH 方法类似地创建 A,B,C 连接，所以 MDH 方法建模的会有些许不同，由于多了一组参数，Joint 会多一个


# MDH 参数建模调整

有几个问题：
- 首先是面板没有应用 ConvertMDH 的参数，因为勾选后面板应该显示转换后的参数组
- 以 REF 为例，第二个关节生成有误，第二组转换过的参数是 { theta: 0, d: 0.5, a: 1, alpha: 90, thetaOffset: 0 }，这应该是按第一个 joint 的 frame 的 x 轴先移动 a(1) 距离，按 x 轴旋转 alpha(90°), 然后在沿着 z 轴移动 d(0.5)距离，现在的做法似乎不是这样

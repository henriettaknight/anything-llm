# 对UE5蓝图项目进行全面静态缺陷检测

## 角色与目标
- 你是资深UE5蓝图架构专家，精通蓝图系统机制、性能优化与常见陷阱。
- 不假设存在任何既知缺陷或清单；完全基于当前蓝图进行逐节点体检，确保无遗漏高风险场景。
- 输出一个高信噪比的缺陷报告，覆盖所有预设缺陷类别，给出精准且最小化入侵的修复建议，杜绝虚假缺陷。

## 项目背景与范围
- 引擎/平台：Unreal Engine 5、蓝图系统、Windows/多平台。
- 蓝图根目录：Content/Blueprints
- 排除目录：Developers, Collections, __ExternalActors__, __ExternalObjects__ 等临时/缓存目录。
- 文件类型：.uasset（蓝图资产）、.umap（关卡）

## 重点缺陷类别与检测要点

### NULL（空引用/空指针）
- **核心问题**：未检查对象有效性就直接使用
- **检测原则**：**极度保守，宁可漏报不可误报**

#### 必须报告的情况（明确的高风险）
仅报告以下 6 种明确可能为空且未检查的情况：

1. **Spawn Actor 未检查**
   - `Spawn Actor → 直接使用返回值`（未连接 IsValid 或 Branch）
   - Spawn 可能因碰撞、资源不足等原因失败返回 None

2. **Cast 失败分支未处理**
   - `Cast to Type → 直接使用 As Type 输出`（Cast Failed 引脚未连接）
   - Cast 失败时 As Type 输出为 None

3. **Get Actor of Class 未检查**
   - `Get Actor of Class → 直接使用返回值`（未检查是否为 None）
   - 场景中可能不存在该类型的 Actor

4. **Get Pawn 未检查**
   - `Get Pawn → 直接使用返回值`（未连接 IsValid 或 Branch）
   - Pawn 可能为 None（角色死亡、未 Possess、Unpossess 等）
   - **重要**：这是最常见的崩溃原因之一

5. **数组 Find 返回 -1 后用于 Get**
   - `Array Find → Get (at Index)`（未检查 Find 返回值是否为 -1）
   - Find 未找到时返回 -1，用于 Get 会越界

6. **Load Asset 未检查**
   - `Load Asset (Sync/Async) → 直接使用返回值`（未检查是否为 None）
   - 资源可能不存在或加载失败

#### 不报告的情况（避免误报）

**A. 引擎保证有效的 API（极少数）**
- Get World - 在游戏运行时始终有效
- Get Game Instance - 在游戏运行时始终有效
- Get Player Controller (Index 0) - 在单人游戏中始终有效
- Get Owning Player - 在 Widget 中始终有效

**注意：以下 API 不保证有效，需要检查：**
- Get Pawn - 可能为 None（角色死亡或未 Possess 等）
- Get Owner - 可能为 None（未设置 Owner）
- Get Instigator - 可能为 None（未设置 Instigator）
- Get Player State - 可能为 None（网络延迟或未初始化）
- Get Controller - 可能为 None（Pawn 未被 Possess）

**B. 编辑器中已添加的组件**
- `Get Component by Class` - 如果组件在编辑器的 Components 面板中已添加
- `Get Component by Tag` - 如果组件在编辑器中已添加并设置了 Tag
- `Get Child Actor Component` - 如果子 Actor 在编辑器中已设置
- 判断依据：检查蓝图的 Components 面板是否存在该组件

**C. 函数参数（非可选）**
- 所有非 Optional 的函数参数默认假设为有效
- 原因：蓝图编辑器在连接节点时已验证类型匹配
- 例外：参数明确标记为 Optional 或函数注释说明可能为空

**D. 已初始化的变量**
- 在 BeginPlay 中赋值的变量，在 Tick 或其他后续事件中使用
- 在 Construction Script 中赋值的变量
- 在 Class Defaults 中设置了默认值的变量
- 判断依据：追踪变量的赋值路径

**E. 已检查的对象**
- `IsValid → Branch → True` 分支中使用的对象
- `Is Valid (pure) → Branch → True` 分支中使用的对象
- `!= None → Branch → True` 分支中使用的对象
- `Cast → Success` 分支中使用的对象（Cast Failed 已连接）

**F. 特殊的安全模式（已检查的对象）**
- Get Pawn 后通过 IsValid 检查再使用 - 已检查，安全
- Get Pawn 后通过 != None 检查再使用 - 已检查，安全
- Try Get Pawn Owner - 专门设计为安全的 API，失败返回 None 但不崩溃
- Get Component 后通过 Branch 检查再使用 - 已检查，安全

**G. 同一对象的多次使用（隐式验证）**
- 如果对象在同一函数中第一次使用时已隐式验证（如调用了方法未崩溃），后续使用假设为安全
- 例：Actor.GetLocation 后调用 Actor.GetRotation - 第一次调用成功说明 Actor 有效
- **注意**：这仅适用于同一执行路径，不适用于不同的事件或函数

**H. 网络相关的特殊情况（有条件保证）**
- Get Player State - 仅在 PlayerController 的 BeginPlay 之后且网络已同步时有效
- Get Pawn - 仅在 PlayerController 的 OnPossess 事件之后有效
- Get Controller - 仅在 Pawn 的 OnPossessed 事件之后有效
- **重要**：在其他情况下（如 BeginPlay 或 Tick），这些 API 可能返回 None，必须检查

#### 具体示例（明确的报告规则）

**❌ 必须报告的情况：**
1. Spawn Actor 后直接使用返回值且未检查
2. Cast 节点的 Cast Failed 引脚未连接
3. Get Actor of Class 后直接使用且未检查
4. Get Pawn 后直接使用且未检查
5. Array Find 返回值直接用于 Get 且未检查是否为 -1
6. Load Asset 后直接使用且未检查
7. Get Controller 后直接使用且未检查

**✅ 不报告的情况（避免误报）：**
1. 函数参数直接使用（非 Optional 参数）
2. Get Component by Class 获取编辑器中已添加的组件
3. Get Player Controller / Get World / Get Game Instance 等引擎保证有效的 API
4. 已通过 IsValid 或 Branch 检查后使用的对象
5. 在 BeginPlay 中初始化后在 Tick 中使用的变量
6. Cast 节点已连接 Cast Failed 分支的情况
7. 在 Class Defaults 中已设置默认值的变量
8. 事件参数（如 OnPossess 的 Possessed Pawn）
9. 同一执行路径中第一次调用成功后的后续调用

#### 检测流程（减少误报）
1. **识别节点类型**：确认是否为上述 5 种必须报告的情况
2. **检查是否已验证**：查找 IsValid、Branch、Cast Failed 等检查节点
3. **追踪变量来源**：确认变量是否在 BeginPlay/Construction Script 中初始化
4. **检查组件面板**：确认组件是否在编辑器中已添加
5. **判断 API 类型**：确认是否为引擎保证有效的 API
6. **如有疑问，不报告**：无法确定是否为真实缺陷时，选择不报告

### TICK（Tick/Event 性能问题）
- **核心问题**：在高频事件中执行重型操作
- **检测模式**：
  - Event Tick 中包含 Get All Actors of Class
  - Event Tick 中包含 Line Trace / Sphere Overlap 等碰撞检测
  - Event Tick 中包含 Set Material / Set Mesh 等资源操作
  - Event Tick 中包含复杂数学运算（未使用 Interp 节点）
  - Event Tick 中包含 Print String / Draw Debug（发布版本未移除）
  - Event Tick 中包含 For Each Loop 遍历大量元素
  - Event Tick 中包含 Delay 节点（会导致逻辑混乱）
- **建议**：使用 Timer、Custom Event、Event Dispatcher 替代

### LOOP（循环/迭代问题）
- **核心问题**：循环中的不安全操作
- **检测模式**：
  - For Each Loop 中修改正在遍历的数组（Add/Remove）
  - For Loop 中使用 Break 但未正确处理后续逻辑
  - 嵌套循环未设置最大迭代次数（可能死循环）
  - 循环中包含 Spawn Actor / Load Asset 等重型操作
  - 循环中包含 Delay 节点（会导致异步问题）
  - 循环索引计算错误（如 Length - 1 未处理空数组）
- **具体示例**：
  - For Each Loop 中调用 Remove from Array（迭代器失效）
  - While Loop 无退出条件或条件永远为 True

### ARRAY（数组操作问题）
- **核心问题**：数组越界或无效访问
- **检测模式**：
  - Get 节点使用固定索引（如 0）未检查数组长度
  - Remove Index 使用的索引未验证范围
  - Insert 节点索引超出数组长度
  - Last Index 用于空数组
  - Find 节点返回 -1 后直接用于 Get
  - 数组作为函数参数传递但未检查是否为空
- **具体示例**：
  - Get (at 0) 直接使用（数组可能为空）
  - Find 后直接用于 Get（Find 返回 -1 时 Get 会失败）

### EVENT（事件/委托问题）
- **核心问题**：事件绑定泄漏或重复绑定
- **检测模式**：
  - Bind Event 未在 EndPlay/Destroyed 中 Unbind
  - 同一事件多次 Bind 未先 Unbind（导致重复触发）
  - Event Dispatcher 调用时未检查是否有绑定
  - Custom Event 标记为 Reliable 但参数过大（网络同步问题）
  - Multicast Delegate 在客户端调用（应在服务器调用）
  - Timer 设置后未在销毁时 Clear（导致悬空引用）
- **具体示例**：
  - BeginPlay 中 Bind Event to OnDamaged（未在 EndPlay 中 Unbind）
  - Set Timer by Event 后 Destroy Actor（Timer 未清理）

### CAST（类型转换问题）
- **核心问题**：不安全的类型转换
- **检测模式**：
  - Cast 节点未连接 Cast Failed 分支
  - 连续多次 Cast 未检查中间结果
  - Cast 到不相关的类型（如 Actor to Widget）
  - 使用 Cast 代替 Interface 调用（性能问题）
  - 在循环中频繁 Cast（应缓存结果）
- **具体示例**：
  - Get Player Pawn 后 Cast to MyCharacter 直接使用（未处理 Cast 失败）
  - For Each Loop 中频繁 Cast to Enemy（应使用 Interface）

### REF（循环引用/硬引用）
- **核心问题**：资源加载和内存泄漏
- **检测模式**：
  - 蓝图类直接引用大型资产（Mesh/Texture/Animation）
  - 蓝图间相互硬引用（A 引用 B，B 引用 A）
  - Class Reference 变量未使用 Soft Class Reference
  - Actor Reference 变量未使用 Soft Object Reference
  - 在蓝图默认值中引用其他蓝图类
  - Widget 蓝图引用 Gameplay 蓝图（应使用 Interface）
- **建议**：使用 Soft Reference、Asset Manager、异步加载

### REPLICATE（网络同步问题）
- **核心问题**：网络同步逻辑错误
- **检测模式**：
  - Replicated 变量未设置 Replication Condition
  - RepNotify 函数中包含仅服务器逻辑（Has Authority 检查）
  - RPC 函数未检查 Authority（Server RPC 在客户端调用）
  - Multicast RPC 参数过大（超过 MTU）
  - Client RPC 在服务器上调用但未检查连接
  - Replicated 变量频繁修改（应使用 RPC 或批量更新）
  - 网络相关逻辑未使用 Switch Has Authority 节点
- **具体示例**：
  - Set Health (Replicated) in Tick（频繁同步）
  - Server RPC 后 Spawn Actor（未检查 Authority）

### INTERFACE（接口使用问题）
- **核心问题**：接口调用不当
- **检测模式**：
  - Does Implement Interface 检查后未连接失败分支
  - Interface Message 调用未检查返回值
  - 应使用 Interface 的地方使用了 Cast（性能问题）
  - Interface 函数参数过多（应使用结构体）
  - Interface 函数未标记为 BlueprintCallable
- **建议**：优先使用 Interface 而非 Cast 进行解耦

### RESOURCE（资源管理问题）
- **核心问题**：资源加载和释放不当
- **检测模式**：
  - Load Asset 同步加载大型资源（应使用异步加载）
  - Spawn Actor 未设置 Owner 或 Instigator
  - Create Widget 后未 Add to Viewport 或未 Remove from Parent
  - Spawn Emitter/Sound 未设置 Auto Destroy
  - Open Level 未使用 Streaming Level（大关卡）
  - Construct Object from Class 创建的对象未释放
  - Niagara/Cascade 粒子系统未设置生命周期
- **具体示例**：
  - Create Widget 后 Store in Variable（未添加到视口或未释放）
  - Spawn Emitter Attached 在 Loop 中（粒子未自动销毁）

### INIT（初始化问题）
- **核心问题**：变量未正确初始化
- **检测模式**：
  - 变量在 BeginPlay 前被访问（Construction Script 中使用）
  - 变量默认值未设置（数值类型应设为 0，布尔应设为 False）
  - 数组/Map/Set 变量未初始化就使用
  - Component 引用在 BeginPlay 前访问（应在 Construction Script 中获取）
  - 网络同步变量在客户端未初始化（RepNotify 未触发时）
- **具体示例**：
  - Construction Script 中 Get Health（Health 可能未初始化）

### ANIM（动画蓝图问题）
- **核心问题**：动画蓝图性能和逻辑问题
- **检测模式**：
  - Event Blueprint Update Animation 中包含 Get All Actors
  - 动画蓝图中包含复杂逻辑（应在 Character 蓝图中处理）
  - Blend Space 输入值未 Clamp（可能超出范围）
  - Animation Montage 播放未检查是否已在播放
  - State Machine Transition 条件过于复杂
  - 动画通知（Anim Notify）中包含重型操作
- **建议**：动画蓝图应保持轻量，复杂逻辑移至 Character

### UI（UI蓝图问题）
- **核心问题**：Widget 蓝图性能和架构问题
- **检测模式**：
  - Event Tick 中更新 UI 文本/图片（应使用绑定或事件驱动）
  - Widget 直接引用 GameMode/PlayerController（应使用 Interface）
  - Create Widget 在循环中调用（应使用对象池）
  - Widget 未在 Destruct 中清理绑定/Timer
  - Binding 函数中包含复杂逻辑（每帧调用）
  - Widget Animation 未检查是否正在播放
  - Scroll Box 包含大量子 Widget（应使用虚拟化）
- **具体示例**：
  - Event Tick 中 Set Text（应使用 Binding 或 Event）
  - For Loop 中 Create Widget（应使用对象池）

### COMPILE（编译警告/错误）
- **核心问题**：蓝图编译问题
- **检测模式**：
  - 节点显示警告图标（黄色感叹号）
  - 节点显示错误图标（红色 X）
  - 变量类型不匹配需要自动转换
  - 函数调用参数数量不匹配
  - 已删除的变量/函数仍被引用
  - Reroute 节点过多导致可读性差
  - 未连接的执行引脚（白色引脚悬空）
- **建议**：定期编译并修复所有警告

## 蓝图特定规则（重要）

### 有效性检查模式识别
**以下模式视为已正确检查，不报告为缺陷：**
1. IsValid 节点检查后使用对象
2. Cast 节点连接了 Cast Failed 分支
3. Switch Has Authority 节点正确使用
4. Array Length 检查后访问数组元素

### 虚假缺陷过滤规则（关键：减少误报）

#### 规则 1：默认值检查
- 如果变量在蓝图编辑器中设置了默认值，不报告为"未初始化"
- 数值类型默认为 0，布尔默认为 False，对象引用默认为 None

#### 规则 2：引擎保证的有效性
- GetWorld、GetGameInstance、GetPlayerController(0) 等引擎 API 在正常游戏流程中保证有效
- Component 引用在 BeginPlay 后保证有效（如果在编辑器中已添加）
- GetOwner、GetInstigator 在 Actor 生命周期内保证有效（如果已正确设置）

#### 规则 3：Event Graph 执行顺序
- BeginPlay 在 Tick 之前执行，BeginPlay 中初始化的变量在 Tick 中使用是安全的
- Construction Script 在 BeginPlay 之前执行

#### 规则 4：网络同步
- Replicated 变量在客户端可能延迟更新，但不视为"未初始化"缺陷
- RepNotify 函数会在变量首次同步时调用

#### 规则 5：蓝图函数参数（重要：减少误报）
**蓝图函数的输入参数默认假设为有效（非空），除非有明确证据表明可能为空：**
- **原因**：蓝图编辑器在连接节点时会进行类型检查，如果参数类型不匹配或为空，蓝图会显示编译错误
- **不报告为缺陷的情况**：
  - 函数参数直接使用
  - 函数参数传递给其他函数
  - 函数参数的成员访问
- **需要报告为缺陷的情况**（有明确证据表明可能为空）：
  - 参数标记为 Optional（可选参数）
  - 参数类型为 Soft Reference（软引用）
  - 函数注释明确说明"参数可能为 None"
  - 函数内部有 IsValid 检查但检查后的分支逻辑不完整
- **示例**：
  - 不报告：函数接收 WeaponComponent 参数后直接调用 SetVisibility
  - 报告：函数接收 Optional 的 WeaponComponent 参数后直接调用 SetVisibility

#### 规则 6：蓝图返回值的上下文检查
**不要孤立地判断返回值是否检查，要看调用上下文：**
- **不报告为缺陷的情况**：
  - 返回值来自 Get Component（如果组件在编辑器中已添加）
  - 返回值来自 Get Variable（如果变量在 BeginPlay 中已初始化）
  - 返回值在同一函数内多次使用（第一次使用时已隐式验证）
- **需要报告为缺陷的情况**：
  - Spawn Actor 返回值未检查
  - Cast 返回值未检查
  - Find 返回值未检查
  - Get Actor of Class 返回值未检查（可能找不到）
  - Load Asset 返回值未检查（可能加载失败）

#### 规则 7：编辑器已验证的引用
**蓝图编辑器在编译时已验证的引用不报告为缺陷：**
- 在 Details 面板中设置的 Actor/Component 引用（Instance Editable）
- 在 Class Defaults 中设置的 Class Reference
- 通过 Get Component by Class 获取的组件（如果组件确实存在）
- 通过 Get Child Actor Component 获取的子 Actor（如果已设置）

#### 规则 8：蓝图编译器的隐式检查
**蓝图编译器会进行以下隐式检查，不需要报告：**
- 节点连接的类型匹配（引擎已验证）
- 执行引脚的连接完整性（引擎已验证）
- 变量作用域的有效性（引擎已验证）
- 函数签名的匹配性（引擎已验证）

### 不报告为缺陷的情况（完整列表）
1. 引擎自动管理的资源（World、GameInstance、PlayerController 等）
2. Component 引用（在编辑器中已添加的组件）
3. 已通过 IsValid/Branch 检查的对象
4. Cast 节点已连接 Cast Failed 分支的情况
5. 测试/调试蓝图中的故意缺陷
6. **蓝图函数的非可选参数（编辑器已验证类型匹配）**
7. **在 Details 面板中设置的引用（Instance Editable）**
8. **在 BeginPlay 中初始化后在 Tick 中使用的变量**
9. **Get Component 返回的组件（如果组件在编辑器中已添加）**
10. **蓝图编译器已验证的节点连接**

## 审查深度与优先级
- P0：会导致崩溃/空引用/网络同步错误（NULL/REPLICATE/COMPILE）
- P1：严重性能问题或资源泄漏（TICK/LOOP/RESOURCE/REF）
- P2：架构问题或最佳实践（INTERFACE/UI/ANIM/CAST）

## 输出报告格式（请严格遵循）
以Markdown表格输出，每条一行，字段如下：
- No：1，2，3递增
- Category: NULL/TICK/LOOP/ARRAY/EVENT/CAST/REF/REPLICATE/INTERFACE/RESOURCE/INIT/ANIM/UI/COMPILE
- Blueprint: 蓝图资产路径（如 Content/Blueprints/Characters/BP_PlayerCharacter）
- Graph/Function: 事件图表或函数名（如 EventGraph, Event BeginPlay, UpdateHealth）
- NodeDescription: 问题节点描述（如 "Get Player Pawn → Cast to MyCharacter → Get Mesh"）
- Risk: 风险说明（崩溃/泄漏/性能/网络同步）
- HowToTrigger: 触发/重现条件
- SuggestedFix: 最小化入侵修复建议
- Confidence: High/Medium/Low

示例：
| No | Category | Blueprint | Graph/Function | NodeDescription | Risk | HowToTrigger | SuggestedFix | Confidence |
|----|----------|-----------|----------------|-----------------|------|--------------|--------------|------------|
| 1 | NULL | Content/Blueprints/Characters/BP_Player | Event BeginPlay | Get Pawn 后直接调用 Set Actor Location | 空引用崩溃 | Pawn 未生成时调用 | 在 Get Pawn 后添加 IsValid 检查 | High |
| 2 | TICK | Content/Blueprints/AI/BP_Enemy | Event Tick | Get All Actors of Class 在 Tick 中调用 | 严重性能问题 | 每帧执行导致卡顿 | 改用 Timer 每 0.5 秒执行一次 | High |
| 3 | LOOP | Content/Blueprints/Inventory/BP_Inventory | AddItem Function | For Each Loop 中调用 Remove from Array | 迭代器失效 | 循环中移除元素导致崩溃 | 改用 For Loop 倒序遍历 | High |

### 格式要求补充
- **禁止报告虚假缺陷**：按照上述"虚假缺陷过滤规则"严格过滤
- **禁止重复报告**：同一问题的多处出现，仅列示代表性样本并注明"同类多处"
- **禁止模糊描述**：每个缺陷必须有明确的节点路径和触发条件
- **CSV 格式要求**：
  - Risk / HowToTrigger / SuggestedFix 字段使用中文回答
  - NodeDescription 字段避免使用箭头符号，改用"后"、"然后"等连接词
  - SuggestedFix 字段必须简洁，单行描述，不超过50字
  - 避免在字段内使用逗号，改用分号或"和"字连接
  - 所有字段内容必须是单行文本，不包含换行符
  - 复杂的修复建议应拆分为多条独立的缺陷记录

## 报告要求（减少误报的关键原则）

### 核心原则：极度保守，宁可漏报不可误报

- 只基于当前蓝图与通用知识分析，不借助任何既知缺陷ID/清单。
- 所有缺陷必须有明确节点依据，禁止基于"可能存在"的逻辑推测。
- 仅当节点路径满足"缺陷类别定义+可触发条件"时记录。

### 严格的误报过滤（必须遵守）

**1. 空指针检测（NULL 类别）**
- **仅报告 7 种情况**：Spawn Actor、Cast、Get Actor of Class、Get Pawn、Get Controller、Array Find、Load Asset
- **默认假设有效**：函数参数（非 Optional）、编辑器组件、少数引擎 API（Get World、Get Game Instance、Get Player Controller）
- **必须检查**：Get Pawn、Get Controller、Get Owner、Get Instigator、Get Player State
- **如有疑问，不报告**：无法 100% 确定会崩溃的，不报告

**2. 函数参数（所有类别）**
- 非 Optional 参数默认假设为有效，不报告空指针问题
- 编辑器在连接节点时已验证类型匹配

**3. 编辑器组件（所有类别）**
- 在 Components 面板中已添加的组件默认假设为有效
- Get Component by Class 返回的组件不报告空指针问题

**4. 引擎 API（所有类别）**
- Get World、Get Game Instance、Get Player Controller 等引擎 API 默认假设为有效
- 不报告这些 API 返回值的空指针问题

**5. 已初始化变量（所有类别）**
- 在 BeginPlay/Construction Script 中赋值的变量，后续使用时默认假设为有效
- 在 Class Defaults 中设置默认值的变量默认假设为有效

**6. 已检查的对象（所有类别）**
- 通过 IsValid、Branch、Cast Success 检查后的对象默认假设为有效
- 不重复报告已检查的对象

**7. 性能问题（TICK/LOOP 类别）**
- 仅报告明确的性能问题：Event Tick 中的 Get All Actors、循环中的 Spawn Actor
- 不报告"可能"的性能问题

**8. 网络同步（REPLICATE 类别）**
- 仅报告明确的网络错误：Server RPC 未检查 Authority、Replicated 变量在 Tick 中修改
- 不报告"可能"的网络问题

### 优先报告的高风险问题（按优先级排序）

**P0 - 必定崩溃**
1. Spawn Actor 未检查 → 直接使用
2. Cast 失败分支未处理 → 直接使用
3. Get Actor of Class 未检查 → 直接使用
4. Get Pawn 未检查 → 直接使用
5. Get Controller 未检查 → 直接使用
6. Array Find 返回 -1 → 用于 Get
7. For Each Loop 中修改正在遍历的数组

**P1 - 严重性能问题**
1. Event Tick 中的 Get All Actors of Class
2. Event Tick 中的 Line Trace / Overlap
3. 循环中的 Spawn Actor / Load Asset
4. Event Tick 中的 For Each Loop（大数组）

**P2 - 资源泄漏**
1. Create Widget 未 Remove from Parent
2. Bind Event 未 Unbind
3. Timer 未 Clear
4. Spawn Emitter 未 Auto Destroy

### 报告格式要求
- 避免冗长描述，专注关键节点与可操作建议
- 若存在相同模式的多处，仅列示代表性样本并注明"同类多处"以控制篇幅
- Risk / HowToTrigger / SuggestedFix 使用中文回答
- **每个缺陷必须有明确的节点路径和触发条件**
- **禁止报告虚假缺陷**：按照上述"虚假缺陷过滤规则"严格过滤
- **禁止重复报告**：同一问题的多处出现，仅列示代表性样本
- **禁止模糊描述**：必须指明具体的节点和执行路径
- **CSV 格式严格要求**：
  - NodeDescription 使用"后"、"然后"等词代替箭头符号
  - SuggestedFix 必须单行且不超过50字
  - 所有字段避免使用逗号，改用分号或"和"字
  - 所有字段必须是单行文本，不包含任何换行符

### 最终检查清单（报告前必须确认）
在报告任何缺陷前，必须确认以下问题：
- [ ] 这是否为上述 7 种必须报告的空指针情况之一？
- [ ] 这个对象是否为函数参数（非 Optional）？→ 如是，不报告
- [ ] 这个组件是否在编辑器中已添加？→ 如是，不报告
- [ ] 这个 API 是否为引擎保证有效的（仅 Get World/Get Game Instance/Get Player Controller）？→ 如是，不报告
- [ ] 这个变量是否已初始化？→ 如是，不报告
- [ ] 这个对象是否已通过 IsValid/Branch 检查？→ 如是，不报告
- [ ] 我是否 100% 确定这会导致崩溃/性能问题？→ 如否，不报告

**特别注意：Get Pawn、Get Controller、Get Owner、Get Instigator、Get Player State 都可能返回 None，必须检查！**

**如果对任何一项有疑问，选择不报告。**

## 分析方法与步骤

### 蓝图遍历策略
1. **优先检查高频事件**：Event Tick、Event Blueprint Update Animation
2. **检查生命周期事件**：BeginPlay、EndPlay、Destroyed
3. **检查网络相关**：Server/Client/Multicast RPC、RepNotify 函数
4. **检查自定义函数**：特别是被多处调用的公共函数
5. **检查 Construction Script**：资源引用和初始化逻辑

### 典型检索关键词
- 空引用：Get 节点后直接调用、Cast 无失败分支、Spawn 未检查、IsValid 缺失
- 性能：Event Tick 中的重型操作、循环中的 Spawn/Load、Get All Actors
- 循环：For Each Loop 中的 Add/Remove、While Loop 无退出、嵌套循环
- 数组：Get (at 0)、Find 返回 -1、Remove Index、Last Index
- 事件：Bind Event 无 Unbind、Timer 未 Clear、重复绑定
- 网络：Replicated 变量频繁修改、RPC 无 Authority 检查、Multicast 参数过大
- 资源：Create Widget 未释放、Spawn Emitter 未 Auto Destroy、Load Asset 同步加载

## 注意事项
- 明确排除规则，以下情况不视为缺陷：
  - 引擎保证有效的对象（World、GameInstance 等）
  - 已通过 IsValid/Branch 检查的对象
  - Cast 节点已连接失败分支的情况
  - 测试/调试蓝图中的故意缺陷
- 不要修改任何蓝图；仅输出报告与建议。
- 关注蓝图特有的问题模式，不要套用 C++ 的检测规则。
- 优先报告会导致崩溃和严重性能问题的缺陷。

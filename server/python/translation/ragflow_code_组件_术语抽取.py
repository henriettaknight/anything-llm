# -*- coding: utf-8 -*-
"""
RAGFlow Code 组件 —— 术语抽取与提示词注入
=========================================
由 gen_code_component.py 从 glossary_unified_v1.jsonl 自动生成，请勿手工编辑本文件。
生成时间：2026-08-25 00:27    术语库版本：v1.1    内联词条：961 条（mandatory 204 / preferred 757）

【RAGFlow 配置步骤】
  1. Agent 画布上添加 Code 组件，语言选 Python
  2. Input variables 添加一个变量，命名 source_text，指向上游的待译原文
  3. 把本文件全部内容粘贴进代码框
  4. Output 声明四个输出：glossary(string)、term_total(number)、
     mandatory_count(number)、preferred_count(number)
  5. 下游 Generate / Agent 组件的系统提示词里引用 {glossary}

【依赖】纯标准库，无 import 第三方包，可在 gVisor 沙箱内运行。
【性能】Aho-Corasick 单次扫描，O(文本长度)，与词条数无关。实测 18 万字约 40ms。
"""

# ============================================================================
# 内联术语库：每行一条，字段用 ";;" 分隔，多值用 "|" 分隔
# 字段顺序：中文主词条 ;; 英文译法 ;; 级别(m/p/r) ;; 中文异写 ;; 禁用译法
# ============================================================================
_GLOSSARY = """\
䑏疏;;Quanshu (Fire-Averting Beast);;p;;;;
一同山;;Mount Subsume;;p;;;;
一步少;;Thousand-steps (Mirage);;p;;;;
一气化三清;;One Qi Transforms Three Purities;;p;;;;
一炷香的时间;;The time it takes for an incense stick to burn;;p;;;;
一盏茶的工夫;;After the time it took to brew a cup of tea;;p;;;;
一级妖兽;;Level One Demonic Beast;;p;;;;
七宝池;;Seven Treasures Pond;;p;;;;
七宝琉璃火;;Seven Treasures Glazed Flame;;p;;;;
七彩鹿;;Seven-colored Deer;;p;;;;
七霞莲;;Seven-colored Aurora Lotus;;p;;;;
万剑归宗;;Ten Thousand Swords Return to Origin;;p;;;;
万古坟场;;Ten Thousand Ancient Graveyard;;p;;;;
万妖山脉;;Ten Thousand Demon Mountains;;p;;;;
万年玄玉;;Ten Thousand Years Profound Jade;;p;;;;
万年石髓;;Ten Thousand Years Stone Marrow;;p;;;;
万毒不侵体;;Ten Thousand Poison Immunity Body;;p;;;;
万毒窟;;Ten Thousand Poison Cave;;p;;;;
万毒门;;Ten Thousand Poison Gate;;p;;;;
万法不侵;;Immunity to All Magics;;p;;;;
万鬼噬魂阵;;Ten Thousand Ghost Soul Devouring Array;;p;;;;
万魂幡;;Ten Thousand Soul Banner;;p;;;;
三修;;Threefold Cultivation;;m;;;;
三光神水;;Three Lights Divine Water;;p;;;;
三千雷动;;Three Thousand Lightning Movement;;p;;;;
三头六臂;;Three Heads and Six Arms;;p;;;;
三宝;;Three Treasures;;p;;;;
三法印;;Three Dharma Seals;;p;;;;
三清;;Three Pure Ones;;p;;;;
三界;;Three Realms (Desire, Form, Formless);;p;;;;
三足金乌;;Three-legged Golden Crow;;p;;;;
上古;;Ancient Era;;p;;;;
上品法器;;High-grade Faqi;;p;;;;
上品灵器;;High-grade Lingqi;;p;;;;
上清;;Supreme Pure;;p;;灵宝天尊;;
下品法器;;Low-grade Faqi;;p;;;;
下品灵器;;Low-grade Lingqi;;p;;;;
不周山;;Mount Buzhou (Broken Pillar);;p;;;;
不死长生功;;Undying Live Forever Technique;;p;;;;
业力;;Karmic Burden;;p;;;;
业火;;Karmic Flame;;p;;;;
业火红莲;;Karmic Flame Red Lotus;;p;;;;
业火红莲台;;Karmic Flame Lotus Throne;;p;;;;
业障;;Karmic Obstacles;;p;;;;
东华帝君;;Donghua Dijun (Eastern Emperor);;p;;;;
两 (liǎng)（银两);;tael;;p;;;;
两仪微尘阵;;Dual Dust Particle Formation;;p;;;;
中古;;Middle Era;;m;;;;
中品法器;;Mid-Grade Magical Artifact;;p;;;;
中品灵器;;Mid-Grade Spiritual Artifact;;p;;;;
中期;;Intermediate Stage;;m;;;;
中洲;;Midland;;m;;;;
丹塔;;Alchemy Tower;;p;;;;
丹师;;Elixir Master;;p;;;;
丹方;;Elixir recipe;;p;;;;
丹火;;Core Flame;;m;;;;
丹田;;Dantian;;p;;;;
丹药;;Elixir;;p;;;;
主脉;;Main;;m;;支脉子弟;;
乌酸木;;Ebonsour;;m;;;;
乘黄;;Chenghuang (Longevity Beast);;p;;;;
九华山;;Mount Jiuhua (Ksitigarbha’s Abode);;p;;;;
九天息壤;;Nine Heavens Breath Soil;;p;;;;
九天玄女;;Jiutian Xuannü (Mysterious Lady of Nine Heavens);;p;;;;
九天雷火阵;;Nine Heavens Thunderfire Formation;;p;;;;
九头狮鹫;;Nine-headed Griffon;;p;;;;
九子连环刃;;Nine Linked Blades;;p;;;;
九宫八卦阵;;Nine Palaces Eight Trigrams Formation;;p;;;;
九尾天狐;;Nine-tailed Heavenly Fox;;p;;;;
九尾狐;;Nine-Tailed Fox;;p;;;;
九幽冥火诀;;Nine Netherworld Flame Art;;p;;;;
九幽冥火阵;;Nine Netherworld Flame Array;;p;;;;
九幽冥铁;;Nine Netherworld Iron;;p;;;;
九幽冥雀;;Nine Nether Sparrow;;p;;;;
九幽宗;;Nine Nether Sect;;p;;;;
九幽寒铁;;Nine Nether Cold Iron;;p;;;;
九幽锁链;;Nine Nether Chains;;p;;;;
九幽锁魂阵;;Nine Nether Soul Locking Formation;;p;;;;
九幽黄泉;;Nine Nether Yellow Spring;;p;;;;
九幽黄泉阵;;Nine Nether Yellow Spring Formation;;p;;;;
九眼天蚕;;Nine-eyed Heavenly Silkworm;;p;;;;
九转玄元丹;;Nine Revolutions Mystic Pill;;p;;;;
九转还魂丹;;Nine Revolutions Soul Revival Pill;;p;;;;
九转金丹;;Nine Revolutions Golden Core;;p;;;;
九转金身诀;;Nine Revolutions Golden Body Art;;p;;;;
九重天阙;;Nine Heavens Palace;;p;;;;
九阳神体;;Nine Yang Divine Body;;p;;;;
九阴煞气;;Nine Yin Baleful Qi;;p;;;;
九霄御雷真诀;;Nine Heavens Thunder Control Art;;p;;;;
九黎壶;;Nine Li Pot;;p;;;;
乾坤挪移大法;;Universe Shifting Art;;p;;;;
乾坤无极阵;;Universe Infinite Formation;;p;;;;
乾坤袋;;Universe Pouch;;p;;;;
乾坤鼎;;Universe Cauldron;;p;;;;
二级妖兽;;Level Two Demonic Beast;;p;;;;
五台山;;Mount Wutai (Manjushri’s Abode);;p;;;;
五圣幽泽;;Five Sages' Marsh;;m;;;;
五方天帝;;Five Heavenly Emperors;;p;;;;
五蕴;;Five Aggregates;;p;;;;
五行;;Five Elements (Metal, Wood, Water, Fire, Earth);;m;;;;
五行灵珠;;Five Elements Spirit Pearl;;p;;;;
五行遁术;;Five Elements Escape Technique;;p;;;;
五行遁甲术;;Five Elements Armor Art;;p;;;;
五行颠倒阵;;Five Elements Reversal Formation;;p;;;;
五鬼搬运符;;Five Ghosts Transport Talisman;;p;;;;
交易会;;Trade Fair;;p;;;;
亲传弟子;;Direct Disciple;;m;;;;
人参;;Ginseng;;p;;;;
人道;;Human Realm;;p;;;;
仇恨值;;Aggro;;m;;仇恨;;Hate|Hatred
仇恨组件;;Aggro Component;;m;;;;Hate Component
他心通;;Mind Reading;;p;;;;
仙人;;Immortal;;p;;;;
仙凡之隔;;Immortal-Mortal Barrier;;p;;;;
仙器;;Immortal Artifact;;p;;;;
仙气;;Immortal Energy;;p;;;;
仙界;;Immortal Realm;;m;;;;
仙籍;;Immortal Registry;;p;;;;
仙缘;;Immortal Fate;;p;;;;
仙途;;path of immortality;;m;;仙路;;
仙途坎坷;;Bumpy Immortal Path;;p;;;;
仙骨;;Immortal Bone;;p;;;;
仙魔古战场;;Immortal-Demon Ancient Battlefield;;p;;;;
仿制灵宝;;Imitation Spiritual Treasure;;p;;;;
伏背;;Lurkback (one of the "Five Sages", Great Scorpion);;m;;;;
会心;;Crit;;m;;;;
会心抗性;;Crit Resist;;m;;暴击抵抗;;
传承;;Inheritance;;p;;衣钵;;
传送阵;;Teleportation Formation;;p;;;;
伤害延迟;;Damage Delay;;m;;;;
伪渡劫;;False Tribulation;;p;;;;
伪灵根;;False (Spiritual) Root;;m;;;;
伪真仙;;False True Immortal;;p;;;;
体修;;Body Cultivator;;m;;;;
供奉;;Protector;;m;;;;
修为;;Cultivation Base;;m;;;;
修仙;;Immortal Cultivation;;m;;;;
修仙家族;;Cultivation Clan;;p;;;;
修仙者;;Cultivator;;m;;修士;;
修仙联盟;;Cultivation Alliance;;p;;;;
修炼;;cultivation (action);;m;;;;
修炼体系;;Cultivation System;;p;;;;
修炼圣地;;Cultivation Holy Land;;p;;;;
傀儡符;;Puppet Summoning Talisman;;p;;;;
储物袋;;Storage Pouch;;p;;;;
元化期;;Origin Transformation Stage;;p;;;;
元婴;;Nascent Soul;;m;;;;
元婴丹;;Nascent Soul Pill;;p;;;;
元婴期;;Nascent Soul Stage;;p;;;;
元神;;Primordial Spirit;;p;;;;
元精;;Primordial Essence;;p;;;;
元阳;;Primordial Yang;;p;;;;
元阴;;Primordial Yin;;p;;;;
先天化凡;;Innate Mortalization;;p;;;;
先天境;;Innate Realm;;p;;;;
先天道体;;Innate Dao Body;;p;;;;
光灵根;;Light Spiritual Root;;p;;;;
八仙;;Eight Immortals;;p;;;;
八功德水;;Eight Meritorious Waters;;p;;;;
八卦;;Eight Trigrams;;p;;;;
八极崩;;Eight Extremities Collapse;;p;;;;
八正道;;Eightfold Dao;;p;;;;
八门金锁阵;;Eight Gates Golden Lock Formation;;p;;;;
六丁六甲符;;Six Ding Six Jia Talisman;;p;;;;
六翼霜蚣;;Six-winged Frost Centipede;;p;;;;
六道轮回;;Six Realms of Reincarnation;;p;;;;
六道轮回拳;;Six Paths Reincarnation Fist;;p;;;;
共振增伤;;Resonance Bonus Damage;;m;;;;
兵解;;Weapon Liberation;;p;;;;
养精丹;;Nourishing Essence Pill;;p;;;;
养魂丹;;Soul Nourishing Pill;;p;;;;
内丹术;;Internal Alchemy;;p;;;;
内门弟子;;Inner Disciple;;m;;;;
冉遗鱼;;Ranyi Fish (Six-Legged Fish);;p;;;;
冰凤;;Ice Phoenix;;p;;;;
冰封万里;;Ice Seal Ten Thousand Miles;;p;;;;
冰心诀;;Ice Heart Art;;p;;;;
冰河谷;;Ice River Valley;;p;;;;
冰灵根;;Ice Spiritual Root;;p;;;;
冰箭术;;Ice Arrow Technique;;p;;;;
冲击力;;Impact Force;;m;;;;
净灵符;;Purification Talisman;;p;;;;
凝元期;;Essence Condensation Stage;;p;;;;
凝气丹;;Qi Condensation Pill;;p;;;;
凝气散;;Qi Condensation Powder;;p;;;;
凝气期;;Qi Condensation Stage;;p;;;;
凡人修仙传;;A Record of a Mortal's Journey to Immortality;;p;;;;
凡尘;;Mortal Realm;;m;;凡间|人界|凡人界;;
凤凰;;Fenghuang (Chinese Phoenix);;p;;;;
凤栖木;;Phoenix Perching Wood;;p;;;;
分水刺;;Water Splitting Dagger;;p;;;;
分水诀;;Water Splitting Art;;p;;;;
分神期;;Soul Division Stage;;p;;;;
切磋;;Sparring;;p;;;;
刑旅渡;;Exile's Beach;;p;;;;
创世舱;;Genesis Pod;;m;;;;
初期;;Initial Stage;;m;;;;Early Stage
剑修;;Sword Cultivator;;p;;;;
剑域;;Sword Domain;;p;;;;
剑川;;Sword Glacier;;m;;;;
剑意;;Sword Intent;;p;;;;
剑气;;Sword Qi;;p;;;;
剑灵之体;;Sword Spirit Constitution;;p;;;;
剑芒;;Sword Beam;;p;;;;
剑诀;;Sword Art;;p;;;;
功德金光;;Merit Golden Light;;p;;;;
功法;;Cultivation Technique;;m;;心法;;
加速度;;Acceleration;;m;;;;
劫云;;Tribulation Cloud;;p;;;;
化凡期;;Mortal Transformation Stage;;p;;;;
化劲;;Force Dissipation;;m;;;;
化形;;Shape Transformation;;p;;;;
化神期;;Deity Transformation Stage;;p;;;;
化血神刀;;Blood Transmutation Divine Blade;;p;;;;
化道境;;Dao Transformation Realm;;p;;;;
十二因缘;;Twelve Links of Dependent Origination;;p;;;;
千瀑溶洞;;Thousand-Cascade Karst Cave;;m;;;;
千钧;;An immense weight;;p;;万钧;;
半步化神;;Half-Step Deity Transformation;;p;;;;
半步多;;One-single-step (Cliff);;p;;;;
半步真仙;;Half-Step True Immortal;;p;;;;
历练;;Experience;;p;;;;
压制力;;Dominance Force;;m;;;;
参月;;Moongaze (one of the "Five Sages", Great Toad);;m;;;;
双修;;Dual Cultivation;;m;;;;
反震;;Rebound;;m;;;;
古修士洞府;;Ancient Cultivator Cave;;p;;;;
古修士遗址;;Ancient Cultivator Ruins;;p;;;;
古宝;;Ancient Fabao;;p;;;;
合体期;;Conjointment Stage;;p;;;;
合道境;;Dao Union Realm;;p;;;;
后天境;;Acquired Realm;;p;;;;
后期;;Late Stage;;m;;;;
吞天魔功;;Heaven Devouring Demon Art;;p;;;;
吞天鼠;;Heaven Devouring Rat;;p;;;;
员峤;;Yuanjiao (Floating Mountain);;p;;;;
周天星斗阵;;Cosmic Star Formation;;p;;周天星辰大阵;;
周天星辰图;;Cosmic Star Map;;p;;;;
呼风唤雨;;Summon Wind and Rain;;p;;;;
命格;;Destiny Grid;;p;;;;
命灯;;Life Lantern;;p;;;;
命牌;;Life Token;;p;;;;
命门;;Gate of Life;;p;;;;
命魂灯;;Life Soul Lamp;;p;;;;
咸滩;;Brine Shores;;p;;;;
善恶;;Morality;;m;;;;
噬金虫;;Gold Devouring Beetle;;p;;;;
噬魂兽;;Soul Devouring Beast;;p;;;;
囚魔狱;;Devil's Grounds;;p;;;;
四圣谛;;Four Noble Truths;;p;;;;
四象封天阵;;Four Symbols Heaven Sealing Array;;p;;;;
回春丹;;Rejuvenation Pill;;p;;;;
回春宫;;Everlife Palace;;m;;;;
回灵丹;;Spirit Recovery Pill;;p;;;;
因果;;Karma;;p;;;;
因果斩断;;Karma Severing;;p;;;;
因果线;;Karmic Thread;;p;;;;
困阵;;Trapping Formation;;p;;;;
固本培元丹;;Foundation Consolidating Pill;;p;;;;
土墙术;;Earth Wall Technique;;p;;;;
土灵根;;Earth Spiritual Root;;p;;;;
地仙;;Earth Immortal;;p;;;;
地心乳;;Earth Core Milk;;p;;;;
地心炎髓;;Earth Core Flame Marrow;;p;;;;
地火明夷;;Inferno Wound;;p;;;;
地煞石;;Earthly Evil Stone;;p;;;;
地狱道;;Naraka Realm (Hell);;p;;;;
地甲龙;;Earth Armored Dragon;;p;;;;
地脉;;Leyline;;m;;;;Earth Vein|Earth's Spiritual Vein
地行术;;Earth Travel Technique;;p;;;;
地黄精;;Earth Yellow Essence;;p;;;;
坊市;;Market;;p;;;;
坠魔谷;;Fallen Demon Valley;;p;;;;
堂主;;Hall Master;;m;;;;
境界;;Cultivation Realm;;m;;;;
墨河;;River Ink;;m;;;;
墨河村;;Inkwater Village;;m;;;;
墨碑台地;;Ink-Stele Plateau;;m;;;;
墨道学宫;;Ink Academy;;m;;;;
外丹术;;External Alchemy;;p;;;;
夙兴;;Dawn-Rise;;m;;;;
大乘期;;Grand Completion Stage;;p;;;;
大圆满;;Accomplished Stage;;m;;;;
大成;;Great Completion;;p;;;;
大泽菜;;Swamp Green;;m;;;;
大罗境;;Great Luo Realm;;p;;;;
大荒囚天指;;Great Desolate Heaven Shackling Finger;;p;;;;
大衍决;;Great Derivation Art;;p;;;;
天人五衰;;Five Celestial Decays;;p;;;;
天人合一;;Unity of Heaven and Man;;p;;;;
天人合一境;;Unity of Heaven and Man Realm;;p;;;;
天仙;;Celestial Immortal;;p;;;;
天剑宗;;Heavenly Sword Sect;;p;;;;
天劫;;Heavenly Tribulation;;p;;;;
天地同寿;;Shared Lifespan with Heaven and Earth;;p;;;;
天地异象;;Cosmic Event;;m;;;;
天外天;;Beyond Heaven Realm;;p;;;;
天外星铁;;Celestial Meteor Iron;;p;;;;
天妖体;;Heavenly Demon Body;;p;;;;
天妖变;;Heavenly Demon Transformation;;p;;;;
天归残脉;;Tiangui, Broken Leyline of Sands;;p;;;;
天星宫;;Celestial Star Palace;;p;;;;
天晶蚁;;Celestial Crystal Ant;;p;;;;
天机;;Heavenly Mystery;;p;;;;
天机罗盘;;Heavenly Mechanism Compass;;p;;;;
天机迷宫;;Heavenly Mechanism Labyrinth;;p;;;;
天材地宝;;resources and materials;;p;;;;
天渊城;;Heavenly Abyss City;;p;;;;
天渊战场;;Heavenly Abyss Battlefield;;p;;;;
天火焚城;;Celestial Fire City Burning;;p;;;;
天火琉璃;;Celestial Fire Glazed Glass;;p;;;;
天火秘境;;Celestial Fire Secret Realm;;p;;;;
天灵根;;Heavenly (Spiritual) Root;;m;;;;
天狗;;Tian Gou (Heavenly Dog);;p;;;;
天眼通;;Heavenly Eye Insight;;p;;;;
天罗伞;;Heavenly Net Umbrella;;p;;;;
天罗地网阵;;Heavenly Net and Earthly Web Formation;;p;;;;
天罚之眼;;Heavenly Punishment Eye;;p;;;;
天罡北斗步;;Heavenly Dipper Steps;;p;;;;
天罡北斗阵;;Heavenly Dipper Formation;;p;;;;
天罡砂;;Heavenly Purity Sand;;p;;;;
天蛇府;;Heavenly Serpent Mansion;;p;;;;
天道;;Deva Realm;;p;;;;
天道无情;;Heavenly Dao is Merciless;;p;;;;
天道酬勤;;Heavenly Dao Rewards the Diligent;;p;;;;
天门百合;;Empyrean Lily;;m;;;;
天门道;;Empyrean Pass;;m;;;;
天雷符;;Heavenly Thunder Talisman;;p;;;;
天青花;;Heavenly Azure Flower;;p;;;;
天魔解体大法;;Heavenly Demon Dissolution Art;;p;;;;
天龙;;Celestipede (one of the "Five Sages", Great Centipede);;m;;;;
天龙八部;;Eight Classes of Divine Beings;;p;;;;
太一门;;Taiyi Sect;;p;;;;
太上老君;;Taishang Laojun (Lord Lao);;p;;;;
太上长老;;Grand Elder;;m;;;;
太乙境;;Taiyi Realm;;p;;;;
太乙救苦天尊;;Taiyi Jiuku Tianzun (Savior Deity);;p;;;;
太乙神光阵;;Taiyi Divine Light Formation;;p;;;;
太乙精金;;Taiyi Refined Gold;;p;;;;
太乙青木丹;;Taiyi Greenwood Pill;;p;;;;
太初源石;;Primordial Source Stone;;p;;;;
太初禁地;;Primordial Forbidden Zone;;p;;;;
太古;;Primordial Era;;m;;;;
太极;;Taiji (Supreme Ultimate);;p;;;;
太清;;Grand Pure;;p;;道德天尊;;
太清玉液;;Supreme Clarity Jade Elixir;;p;;;;
太虚剑意;;Void Sword Intent;;p;;;;
太虚幻境;;Illusory Realm of Taixu;;p;;;;
太虚神甲;;Void Divine Armor;;p;;;;
太阳神炉;;Solar Divine Furnace;;p;;;;
太阳精金;;Solar Essence Gold;;p;;;;
太阴圣体;;Lunar Holy Body;;p;;;;
太阴寒玉;;Lunar Cold Jade;;p;;;;
太阴玄冰;;Lunar Profound Ice;;p;;;;
夺舍;;Possession;;m;;;;
夺魂摄魄;;Soul Stealing;;p;;;;
奇门遁甲;;Qimen Dunjia (Mystic Gate Escaping);;p;;;;
妖丹;;Demon Core;;m;;;;
妖修;;Demonic Cultivator;;m;;;;
妖兽;;demon;;m;;;;
妖气;;Demon Energy;;p;;;;
妙音门;;Melodic Sound Sect;;p;;;;
娑婆世界;;Saha World (World of Endurance);;p;;;;
婴火;;Soul Flame;;m;;;;
子母阴阳环;;Parent-Child Yin-Yang Rings;;p;;;;
宗门;;Sect;;m;;;;
定海神针;;Ocean Stabilizing Divine Needle;;p;;;;
定颜丹;;Appearance Fixing Pill;;p;;;;
宝塔;;Pagoda;;p;;;;
家族;;Family;;m;;世家;;
寂灭期;;Nirvana Extinction Stage;;p;;;;
寒铁;;Cold Iron;;p;;;;
寿元;;Lifespan;;m;;;;
外门弟子;;Outer Disciple;;m;;;;
尸解;;Corpse Liberation;;p;;;;
山河社稷图;;Mountains and Rivers Map;;p;;;;
山门;;Mountain Gate;;p;;;;
岱舆;;Daiyu (Mythical Mountain);;p;;;;
峨眉山;;Mount Emei (Samantabhadra’s Abode);;p;;;;
崆峒山;;Mount Kongtong;;p;;;;
崖角桃源;;Wondercoast;;p;;;;
巅峰;;Peak Stage;;p;;;;
巩固修为;;Consolidating Cultivation;;p;;;;
师兄;;Senior Brother;;p;;;;
师妹;;Junior Sister;;p;;;;
师姐;;Senior Sister;;p;;;;
师尊;;Venerable Master;;p;;;;
师弟;;Junior Brother;;p;;;;
师父;;Master;;p;;;;
幸运;;Luck;;m;;;;
幻心迷阵;;Heart Illusion Maze;;p;;;;
幻晖眼;;(Lake) Sun's Eye;;p;;;;
幻月洞天;;Illusionary Moon Cave Heaven;;p;;;;
幻阵;;Illusion Formation;;p;;;;
幻音宝盒;;Illusionary Sound Treasure Box;;p;;;;
幽冥地窟;;Netherworld Underground Cave;;p;;;;
幽冥海;;Netherworld Sea;;p;;;;
幽冥狼;;Netherworld Wolf;;p;;;;
幽冥界;;Netherworld Realm;;p;;;;
幽冥虎;;Netherworld Tiger;;p;;;;
幽冥鬼火;;Netherworld Ghost Flame;;p;;;;
幽涧峡谷;;Secluded-Stream Gorge;;m;;;;
应龙;;Yinglong (Rain Dragon);;p;;;;
建木;;Jianmu (World Tree);;p;;;;
异灵根;;Mutated (Spiritual) Root (Ice, Wind, Lightning);;m;;变异灵根;;
弟子;;Disciple;;p;;;;
归一期;;Unity Return Stage;;p;;;;
归墟;;Guixu (Abyssal Void);;p;;;;
归墟境;;Void Return Realm;;p;;;;
当康;;Dangkang (Harvest Beast);;p;;;;
徙徒岭;;Outcast's Ridge;;p;;;;
御器飞行;;Fabao Flight;;m;;;;
御水术;;Water Control Technique;;p;;;;
御风术;;Wind Riding Technique;;p;;;;
心剑;;Heart Sword;;p;;;;
心境;;Mood;;m;;;;
心魔;;Inner Demon;;p;;;;
心魔劫;;Inner Demon Tribulation;;p;;;;
悟性;;Comprehension;;m;;;;
戮仙剑;;Immortal Slaying Sword;;p;;;;
执事;;Steward;;m;;管事;;
扶桑;;Fusang (Sun Tree);;p;;;;
技能冷却;;Skill Cooldown;;m;;;;
技能抗打断;;Skill Interrupt Resist;;m;;;;
抗冲击力;;Impact Resist;;m;;;;
护体罡气;;Protective Aura;;p;;;;
护盾穿透;;Barrier Penetration;;m;;;;
拍卖会;;Auction;;p;;;;
指法;;Finger Technique;;p;;;;
掌法;;Palm Technique;;p;;;;
掌门;;Grandmaster;;m;;;;
摄魂铃;;Soul Capturing Bell;;p;;;;
操控距离增加量;;Control Distance Increase;;m;;;;
攻击力;;Attack;;m;;;;
攻击法器;;Offensive Faqi;;p;;;;
散仙;;Loose Immortal;;p;;;;
散修;;independent cultivator;;p;;;;
文昌帝君;;Wenchang Dijun (God of Literature);;p;;;;
斋醮;;Taoist Ritual;;p;;;;
斗姆元君;;Doumu Yuanjun (Mother of the Dipper);;p;;;;
斗法;;Magical Duel;;p;;;;
斩仙飞刀;;Immortal Slaying Flying Dagger;;p;;;;
斩尸;;Corpse Severing;;p;;;;
斩灵境;;Spirit Severing Realm;;p;;;;
断魂山脉;;Soulrend Ranges;;p;;;;
方丈山;;Fangzhang Mountain;;p;;;;
方圆叶;;Ridgecircle;;m;;;;
施法消耗;;Spell Cost;;m;;;;
施法消耗降低;;Cast Cost Reduction;;m;;;;
施法速度;;Cast Speed;;m;;咏唱速度;;
族老;;Family Elder;;m;;;;
族长;;Patriarch;;m;;;;
无为而治;;Governance by Non-Action;;p;;;;
无天漠;;Lightless Desert;;p;;;;
无明;;Avidya (Ignorance);;p;;;;
无极;;Wuji;;p;;;;
无相天魔;;Formless Heavenly Demon;;p;;;;
时光回溯;;Time Reversal;;p;;;;
时空乱流;;Time-Space Turbulence;;p;;;;
昆仑墟;;Kunlun Ruins;;p;;;;
昆仑虚;;Kunlun Void;;p;;;;
易宫;;Changescale (one of the "Five Sages", Great Lizard);;m;;;;
易容术;;Disguise Art;;p;;;;
易筋丹;;Tendon Changing Pill;;p;;;;
星宫;;Star Palace;;p;;;;
星罗赤炎;;Starblaze Isles;;m;;;;
星辰古路;;Stellar Ancient Path;;p;;;;
星辰战体;;Stellar War Body;;p;;;;
星辰砂;;Stardust Sand;;p;;;;
星陨诀;;Starfall Art;;p;;;;
晋墟;;Ruins of Hope;;p;;;;
普陀山;;Mount Putuo (Avalokiteshvara’s Abode);;p;;;;
暗灵根;;Dark Spiritual Root;;p;;;;
暮湖;;(Lava) Lake Twilight;;p;;;;
暴击率;;Crit Rate;;m;;;;
更始岛;;Newborn Isle;;p;;;;
更始新脉;;The Newborn Leyline;;p;;;;
曼荼罗;;Mandala;;p;;;;
替劫傀儡;;Tribulation Replacement Puppet;;p;;;;
替死傀儡术;;Substitute Puppet Technique;;p;;;;
最大速度;;Max Speed;;m;;;;
木灵根;;Wood Spiritual Root;;p;;;;
未济坡;;Cinderflow Slope;;p;;;;
本命法宝;;Lifebound Treasure;;m;;;;
本命魂器;;Lifebound Soul Artifact;;p;;;;
朱雀;;Vermilion Bird;;p;;;;
朱雀环;;Vermilion Bird Ring;;p;;;;
机缘;;Fortuitous Encounter;;p;;;;
杀阵;;Killing Formation;;p;;;;
杂役弟子;;Servant Disciple;;m;;;;
杏叶葵;;Apricot-Leaf Mallow;;m;;;;
极乐世界;;Pure Land (Sukhavati);;p;;;;
极品法器;;top-grade Faqi;;p;;;;
极品灵器;;top-grade Lingqi;;p;;;;
极西之地;;Far Western Lands;;p;;;;
梼杌;;Taowu (Ignorance Beast);;p;;;;
正道;;Righteous Dao;;p;;;;
步罡踏斗;;Pacing the Stars and Dippers;;p;;;;
每击额外附加伤害;;Bonus Damage Per Hit;;m;;;;
毕方;;Bifang (Fire Bird);;p;;;;
气海;;Qi Sea;;p;;;;
气血;;Health;;m;;;;
气运;;Luck;;p;;;;
水灵根;;Water Spiritual Root;;p;;;;
沧原;;Aeonic Fields;;m;;;;
沧原-大漠;;Aeonic Deserts;;p;;;;
法体双修;;Body and Qi Cultivation;;p;;;;
法修;;Qi Cultivation;;m;;;;
法兵;;Fabing;;m;;;;
法力;;Qi;;p;;;;
法力反噬;;Qi Backlash;;p;;;;
法力屏障;;Qi Barrier;;p;;;;
法力恢复效果提升;;Energy Regen Increase;;m;;;;
法器;;Faqi;;m;;;;
法天象地;;Magic Manifestation Giant Form;;p;;;;
法宝;;Fabao;;p;;;;
法宝增幅;;Fabao Amplification;;m;;;;
法旨;;Divine Decree;;p;;;;
法术伤害加成;;Spell Damage Bonus;;m;;;;
法术伤害抵抗;;Spell Damage Resist;;m;;;;
法相;;Dharma Idol;;p;;;;
法身;;Dharma Body;;p;;;;
波罗蜜;;Paramita (Perfection);;p;;;;
泥丸宫;;Niwan Palace;;p;;;;
洗髓丹;;Marrow Cleansing Pill;;p;;;;
洞天;;Veilland;;m;;;;
洞天福地;;Veillands and Sanctums;;p;;;;
洞府;;Cave Abode;;p;;;;
流离孤脉;;The Exiled Leyline;;p;;;;
济水;;River Grace;;p;;;;
涅槃;;Nirvana;;p;;;;
涅槃境;;Nirvana Realm;;p;;;;
涅槃重生;;Nirvana Rebirth;;p;;;;
涅槃重生体;;Nirvana Rebirth Body;;p;;;;
涌泉穴;;Yongquan Acupoint;;p;;;;
混元一气瓶;;Primordial Unity Vase;;p;;;;
混元境;;Primordial Unity Realm;;p;;;;
混元无极境;;Primordial Infinite Realm;;p;;;;
混元河洛大阵;;Primordial River Luo Formation;;p;;;;
混沌;;Hundun (Primordial Chaos);;p;;;;
混沌之力;;Primordial Chaos Energy;;p;;;;
混沌体;;Primordial Chaos Body;;p;;;;
混沌归元阵;;Primordial Unity Return Formation;;p;;;;
混沌期;;Primordial Chaos Stage;;p;;;;
混沌海;;Primordial Chaos Sea;;p;;;;
混沌钟;;Primordial Chaos Bell;;p;;;;
混沌青莲;;Primordial Azure Lotus;;p;;;;
渡劫;;tribulation;;m;;;;
渡劫期;;Tribulation Transcendence Stage;;p;;;;
渡厄;;Calamity Crossing;;p;;;;
演武场;;Martial Arts Field;;p;;;;
瀑布下溶洞;;Karst Cave beneath a Waterfall;;m;;;;
瀛洲;;Yingzhou (Mystic Isle);;p;;;;
火弹术;;Fire Bullet Technique;;p;;;;
火灵根;;Fire Spiritual Root;;p;;;;
火麒麟;;Fire Qilin;;p;;;;
灵光护体;;Spiritual Light Protection;;p;;;;
灵兽;;Spiritual Beast;;m;;;;
灵兽园;;Spiritual Beast Garden;;p;;;;
灵兽袋;;Spirit Beast Pouch;;p;;;;
灵力;;Qi;;m;;;;
灵力恢复速度;;Qi Regen;;m;;;;
灵力枯竭;;Qi Depletion;;p;;;;
灵动期;;Spirit Awakening Stage;;p;;;;
灵压;;Spiritual Pressure;;p;;;;
灵台;;Spirit Platform;;p;;;;
灵器;;Lingqi;;m;;;;
灵契;;Spirit Contract;;p;;;;
灵宠;;Spiritual Pet;;p;;;;
灵山;;Vulture Peak (Spiritual Mountain);;p;;;;
灵根;;Spiritual Root;;m;;;;
灵根属性;;Spiritual Root Element;;p;;;;
灵根资质;;Spiritual Root Aptitude;;p;;;;
灵植;;spiritual plant;;m;;;;
灵气;;Spiritual Energy;;m;;;;
灵泉;;Spiritual Spring;;p;;;;
灵活度;;Maneuverability;;m;;;;
灵田;;spiritual farm;;p;;;;
灵界;;Spirit Realm;;m;;;;
灵眼;;spiritual eye;;m;;;;
灵眼之树;;Spirit Eye Tree;;p;;;;
灵眼之泉;;Spirit Eye Spring;;p;;;;
灵眼之石;;Spirit Eye Stone;;p;;;;
灵石;;Spirit Stone;;m;;;;
灵矿;;Spirit Mine;;m;;;;
灵缈园;;Ethereal Spirit Garden;;p;;;;
灵脉;;Spirit Vein;;m;;;;
灵脉符;;Spirit Vein Detection Talisman;;p;;;;
灵脉节点;;Spirit Vein Node;;p;;;;
灵芝;;lingzhi;;p;;;;
灵草;;Spiritual Herb;;p;;;;
点化;;Enlightenment Bestowal;;p;;;;
点石成金;;Stone to Gold Transmutation;;p;;;;
炼丹;;Elixir-refining;;m;;;;
炼丹房;;Elixir Chamber;;p;;;;
炼丹炉;;Elixir Furnace;;p;;;;
炼丹阵;;Elixir-refining Formation;;p;;;;
炼器;;Fabao-crafting;;m;;;;
炼器室;;Fabao-crafting Chamber;;p;;;;
炼器阵;;Fabao-crafting Formation;;p;;;;
炼气;;Qi Refinement;;m;;;;
炼气一层;;Qi Refinement Layer 1;;p;;;;
炼气大成;;Major Completion of Qi Refinement;;m;;;;
炼气小成;;Minor Completion of Qi Refinement;;m;;;;
炼气期;;Qi Refinement Stage;;p;;;;
炼符;;Talisman-making;;m;;;;
炼虚合道;;Void Refinement and Dao Union;;p;;;;
炼虚期;;Void Refinement Stage;;p;;;;
炼魂术;;Soul Refining Technique;;p;;;;
烛龙;;Zhulong (Torch Dragon);;p;;;;
焚炎谷;;Blazing Flame Valley;;p;;;;
焚诀;;Flame Mantra;;p;;;;
煊煌山;;Mount Xuanhuang;;p;;;;
煊煌帝脉;;Xuanhuang, Leyline of Majesty;;p;;;;
煞气;;Baleful Energy;;m;;;;
爝火丘;;Embergrave Hill;;p;;;;
爝火余脉;;Juehuo, Leyline of Embers;;p;;;;
牛头草;;Bull's-Head Grass;;m;;;;
物理伤害加成;;Physical Damage Bonus;;m;;;;
物理伤害抗性;;Physical Damage Resist;;m;;物理伤害抵抗;;
獬豸;;Xiezhì (Justice Beast);;p;;;;
玄仙境;;Mystic Immortal Realm;;p;;;;
玄冥神掌;;Profound Darkness Divine Palm;;p;;;;
玄冰;;Profound Ice;;p;;;;
玄冰珠;;Profound Ice Pearl;;p;;;;
玄冰蟒;;Profound Ice Python;;p;;;;
玄冰镜;;Profound Ice Mirror;;p;;;;
玄冰髓;;Profound Ice Marrow;;p;;;;
玄天仙藤;;Profound Heaven Immortal Vine;;p;;;;
玄天剑派;;Profound Heaven Sword Sect;;p;;;;
玄天幻境;;Profound Heaven Illusion Realm;;p;;;;
玄天斩灵剑;;Profound Heaven Spirit Slaying Sword;;p;;;;
玄武;;Xuanwu (the Black Tortoise);;m;;;;
玄水黑蛇;;Profound Water Black Serpent;;p;;;;
玄溟大泽;;Great Deepmist Marsh;;m;;;;
玄灵山;;Mount Xuanling;;m;;;;
玄灵药;;Xuanling Herb;;m;;;;
玄磁山;;Mystic Magnetic Mountain;;p;;;;
玄磁神光;;Mystic Magnetic Light;;p;;;;
玄阴教;;Profound Yin Sect;;p;;;;
玄阴葵水;;Profound Yin Water;;p;;;;
玄阴针;;Profound Yin Needle;;p;;;;
玄黄不灭体;;Primordial Immortal Body;;p;;;;
玄黄母气;;Primordial Yellow Mother Qi;;p;;;;
玄黄鼎;;Primordial Yellow Cauldron;;p;;;;
玄龟;;Profound Turtle;;p;;;;
玉京;;Jadecrawl (one of the "Five Sages", Great Serpent);;m;;;;
玉清;;Jade Pure;;p;;元始天尊;;
玉皇大帝;;Jade Emperor;;p;;;;
王母娘娘;;Queen Mother of the West;;p;;;;
琅嬛福地;;Langhuan Blissful Land;;p;;;;
瑶池;;Jade Pool (Queen Mother’s Abode);;p;;;;
瓶颈;;Bottleneck;;p;;;;
畜生道;;Animal Realm;;p;;;;
疏血平原;;Bleeding Plain;;p;;;;
白泽;;Baize (Omniscient Beast);;p;;;;
白虎;;White Tiger;;p;;;;
百会穴;;Baihui Acupoint;;p;;;;
百草谷;;Hundred Herbs Valley;;p;;;;
监察;;Overseer;;m;;;;
真丹;;True Core;;p;;;;
真仙境;;True Immortal Realm;;p;;;;
真元;;True Essence;;p;;;;
真武大帝;;Zhenwu Emperor (Dark Warrior);;p;;;;
真气;;True Qi;;p;;;;
真火;;True Flame;;p;;;;
真灵;;True Spirit;;p;;;;
真灵境;;True Spirit Realm;;p;;;;
真灵根;;True (Spiritual) Root;;m;;;;
真龙;;True Dragon;;p;;;;
瞿如;;Quru (Three-Legged Bird);;p;;;;
石心苔;;Stone-Heart Moss;;m;;;;
石碑;;Stele;;p;;古碑|碑;;Stone Tablet|Tablet
破妄境;;Illusion Breaking Realm;;p;;;;
破界符;;Realm Breaking Talisman;;p;;;;
破碎虚空;;Shattering the Void;;p;;;;
破障期;;Barrier Breaking Stage;;p;;;;
硬直抵抗;;Stagger Resist;;m;;;;
碎空境;;Void Shattering Realm;;p;;;;
碧波潭;;Azure Wave Pool;;p;;;;
碧灵珊瑚;;Azure Spirit Coral;;p;;;;
碧眼金蟾;;Emerald-eyed Golden Toad;;p;;;;
祖师;;Ancestor Master;;p;;;;
神修;;Spirit Cultivation;;m;;;;
神念;;Divine Will;;p;;;;
神念烙印;;Divine Will Imprint;;p;;;;
神行百变;;Hundred Transformations Movement;;p;;;;
神行符;;Swift Movement Talisman;;p;;;;
神识;;Spirit Sense;;m;;;;
神识伤害强度;;Spirit Sense Damage Strength;;m;;;;
神识伤害抵抗强度;;Spirit Sense Resist Strength;;m;;;;
神识占用量;;Spirit Sense Reserve;;m;;;;
神识强度;;Spirit Sense Strength;;m;;;;
神识扰乱强度;;Spirit Sense Interference Strength;;m;;;;
神识抗扰强度;;Spirit Sense Interference Resist Strength;;m;;;;
神识抵抗;;Spirit Sense Resist;;m;;;;
神识损伤;;Spirit Sense Injury;;m;;;;
神识穿透;;Spirit Sense Penetration;;m;;;;
神识能量;;Spirit Sense Energy;;m;;;;
神识能量恢复;;Spirit Sense Energy Regen;;m;;;;
神识负载;;Spirit Sense Capacity;;m;;;;
神足通;;Divine Foot Travel;;p;;;;
神通;;spell;;m;;;;
神魂受损;;Divine Soul Damage;;p;;;;
禁地;;Forbidden Zone;;p;;;;
禁空禁制;;Flight Prohibition Restriction;;p;;;;
禅定;;Dhyana (Meditative Absorption);;p;;;;
福地;;Sanctum;;m;;;;
离沙;;Bleak Dunes;;p;;;;
离火扇;;Inferno Fire Fan;;p;;;;
离火精魄;;Inferno Fire Essence;;p;;;;
秘境;;Secret Realm;;m;;;;
移动速度;;Movement Speed;;m;;;;
移星换斗;;Shift Stars and Dippers;;p;;;;
稳固境界;;Stabilizing Realm;;p;;;;
穷奇;;Qiongqi (Chaos Beast);;p;;;;
空冥期;;Void Comprehension Stage;;p;;;;
空间裂缝;;Spatial Rift;;p;;;;
空间锁;;Spatial Lock;;p;;;;
突破;;breakthrough;;m;;;;
突破瓶颈;;Breaking Through Bottleneck;;p;;;;
窥天境;;Heaven Peeping Realm;;p;;;;
童子;;Assistant;;m;;;;
符文;;Rune;;m;;;;
符水;;Talisman Water;;p;;;;
符箓;;Talisman;;p;;;;
筑基;;Foundation Establishment;;m;;;;
筑基丹;;Foundation Establishment Pill;;p;;;;
筑基大成;;Major Completion of Foundation Establishment;;m;;;;
筑基小成;;Minor Completion of Foundation Establishment;;m;;;;
筑基巅峰;;Foundation Establishment Peak;;p;;;;
筑基期;;Foundation Establishment Stage;;p;;;;
精气神;;Essence, Qi, Spirit;;p;;;;
精神伤害加成;;Mental Damage Bonus;;m;;;;
精神伤害抗性;;Mental Damage Resist;;m;;;;
紫府;;Purple Mansion (Immortal’s Abode);;p;;;;
紫气东来;;Purple Qi from the East;;p;;;;
紫猴花;;Purple Monkey Flower;;p;;;;
紫电雕;;Purple Lightning Eagle;;p;;;;
紫电雷锤;;Purple Lightning Thunder Hammer;;p;;;;
紫金;;Purple Gold;;p;;;;
紫霄宫;;Purple Sky Palace;;p;;;;
紫髓玉;;Purple Marrow Jade;;p;;;;
终南山;;Mount Zhongnan;;p;;;;
经络;;meridian;;m;;经脉;;
结丹期;;Core Formation Stage;;p;;;;
缚龙索;;Dragon Binding Chains;;p;;;;
缩地成寸;;Earth Shrinking Step;;p;;;;
罡气;;Astral Energy;;p;;;;
老愚谷地;;Life's Folly (Vale);;p;;;;
老祖;;Ancient;;m;;;;
耐久;;Durability;;m;;;;
聚气丹;;Qi Gathering Pill;;p;;;;
胎息;;Embryonic Breathing;;p;;;;
舍利子;;Sariras (Relic Pearls);;p;;;;
般若;;Prajna (Wisdom);;p;;;;
苍溟;;Pinemist;;m;;;;
苍溟山脉;;Pinemist Mountain Range;;m;;;;
苍焚峰;;Scorched Sky Peak;;p;;;;
英招;;Yingzhao (Divine Messenger);;p;;;;
药园;;Medicine Garden;;p;;;;
药鼎;;Medicinal Cauldron;;p;;;;
莲台;;Lotus Throne;;p;;;;
菩提心;;Bodhicitta (Awakening Mind);;p;;;;
葬仙之地;;Immortal Burial Ground;;p;;;;
葬仙陵;;Immortal Burial Mound;;p;;;;
蓄势伤害;;Charge Bonus Damage;;m;;蓄势增伤;;
蓬莱仙岛;;Penglai Immortal Island;;p;;;;
蔓居;;Sprawling Thorn;;m;;;;
藏经阁;;Scripture Pavilion;;p;;;;
虚丹;;Pseudo Core;;p;;;;
虚天殿;;Void Heavenly Hall;;p;;;;
虚空之刃;;Void Blade;;p;;;;
虚空凝剑术;;Void Sword Condensation Art;;p;;;;
虚空大手印;;Void Great Hand Seal;;p;;;;
虚空晶石;;Void Crystal;;p;;;;
虚空禁锢;;Void Imprisonment;;p;;;;
虚空穿梭;;Void Teleportation;;p;;;;
虚空藤;;Void Vine;;p;;;;
虚空裂隙;;Void Rift;;p;;;;
虚空通道;;Void Passage;;p;;;;
虚空鲸;;Void Whale;;p;;;;
蛊雕;;Gudiao (Siren Beast);;p;;;;
蛟龙;;Flood Dragon;;p;;;;
融灵期;;Spirit Fusion Stage;;p;;;;
蟠螭五洲;;Five Continents of Panchi;;m;;;;
血影遁;;Blood Shadow Escape;;p;;;;
血晶芝;;Blood Crystal Mushroom;;p;;;;
血河大阵;;Blood River Grand Formation;;p;;;;
血海修罗功;;Blood Sea Asura Art;;p;;;;
血海冥铜;;Blood Sea Nether Copper;;p;;;;
血海深渊;;Blood Sea Abyss;;p;;;;
血煞教;;Blood Fiend Sect;;p;;;;
血玉蜘蛛;;Blood Jade Spider;;p;;;;
血祭大阵;;Blood Sacrifice Formation;;p;;;;
血脉;;Bloodline;;m;;;;
血遁大法;;Blood Escape Grand Art;;p;;;;
血遁术;;Blood Escape Technique;;p;;;;
血魔殿;;Blood Demon Hall;;p;;;;
血龙木;;Blood Dragon Wood;;p;;;;
袖里乾坤;;Universe Within Sleeve;;p;;;;
裂风兽;;Wind Splitting Beast;;p;;;;
记名弟子;;Nominal Disciple;;m;;;;
论道;;Dao Discussion;;p;;;;
证道;;attained enlightenment;;m;;;;
证道境;;Dao Proving Realm;;p;;;;
识域;;Spirit Sense Area;;m;;;;
试炼之地;;Trial Ground;;p;;;;
诛仙剑阵;;Immortal Slaying Sword Formation;;p;;;;
诛仙阵图;;Immortal Slaying Formation Diagram;;p;;;;
赤水之北;;North of Red River;;p;;;;
赤炎蛟;;Crimson Flame Flood Dragon;;p;;;;
赤血雷豹;;Crimson Thunder Leopard;;p;;;;
赤霄剑;;Scarlet Sky Sword;;p;;;;
走火入魔;;Qi Deviation;;p;;;;
超凡入圣;;Transcend Mortality to Sainthood;;p;;;;
身外化身;;External Avatar;;p;;;;
身法;;Movement Technique;;p;;;;
转轮圣王;;Chakravartin (Wheel-Turning King);;p;;;;
轮回;;Reincarnation;;p;;;;
轮回之井;;Reincarnation Well;;p;;;;
轮回印;;Reincarnation Seal;;p;;;;
轮回境;;Reincarnation Realm;;p;;;;
轮回往生咒;;Reincarnation Incantation;;p;;;;
辟火罩;;Fire Warding Cover;;p;;;;
辟谷;;Grain Avoidance;;p;;;;
辟谷丹;;Grain Avoidance Pill;;p;;;;
近期;;Modern Era;;m;;;;
返璞归真;;Return to Simplicity;;p;;;;
还魂丹;;Soul Returning Pill;;p;;;;
进阶失败;;Failed Advancement;;p;;;;
进阶成功;;Successful Advancement;;p;;;;
远古;;Mythic Era;;m;;;;
迷踪阵;;Maze Formation;;p;;;;
逆天改命;;Defying Heaven and Changing Fate;;p;;;;
逆尘境;;Dust Reversal Realm;;p;;;;
通玄境;;Mystic Comprehension Realm;;p;;;;
遁地符;;Earth Escape Talisman;;p;;;;
遁天舟;;Sky Evasion Boat;;p;;;;
道侣;;Dao Companion;;m;;;;
道劫;;Dao Tribulation;;p;;;;
道友;;Fellow Daoist;;p;;;;
道可道非常道;;The Dao that can be spoken is not the eternal Dao;;p;;;;
道基稳固;;Dao Foundation Stabilization;;p;;;;
道心;;Dao Heart;;p;;;;
道法自然;;Dao Follows Nature;;p;;;;
道生一;;The Dao begets One, One begets Two, Two begets Three, Three begets all things;;p;;一生二|二生三|三生万物;;
道痕;;Dao Mark;;p;;;;
道祖境;;Dao Ancestor Realm;;p;;;;
遗迹;;Ruins;;p;;;;
避尘珠;;Dust Repelling Orb;;p;;;;
避毒珠;;Poison Avoidance Orb;;p;;;;
避水诀;;Water Avoidance Art;;p;;;;
邪道;;Evil Dao;;p;;;;
都天神煞阵;;Capital Divine Evil Formation;;p;;;;
酆都城;;Fengdu (City of the Dead);;p;;;;
重头路;;Road of Turn;;p;;;;
金丹;;Golden Core;;m;;;;
金丹大圆满;;Golden Core Perfection;;p;;;;
金丹大道;;Golden Elixir Great Dao;;p;;;;
金刃术;;Metal Blade Technique;;p;;;;
金刚乘;;Vajrayana (Diamond Vehicle);;p;;;;
金刚座;;Vajrasana (Diamond Throne);;p;;;;
金灵根;;Metal Spiritual Root;;p;;;;
金甲符;;Golden Armor Talisman;;p;;;;
金背妖螂;;Golden-backed Demon Mantis;;p;;;;
金身期;;Golden Body Stage;;p;;;;
金髓丸;;Golden Marrow Pill;;p;;;;
铁风斋;;Ironwind Band;;m;;;;
锁阳丹;;Yang Locking Pill;;p;;;;
锻骨期;;Bone Tempering Stage;;p;;;;
镇岳石碑;;Mountain-Subduing Stele;;m;;;;
镇渊遗迹;;Zhenyan Ruins;;m;;;;
镇魂塔;;Soul Suppressing Pagoda;;p;;;;
长生;;Longevity;;p;;;;
长生丹;;Longevity Pill;;p;;;;
长老;;Elder;;m;;;;
闭关;;Secluded Cultivation;;p;;;;
闭气诀;;Breath Holding Technique;;p;;;;
问道境;;Dao Inquiry Realm;;p;;;;
问鼎期;;Heaven Seeking Stage;;p;;;;
阎浮提;;Jambudvipa (Human Realm);;p;;;;
防御法器;;Defensive Faqi;;p;;;;
阳和教;;Wakespring Order;;m;;;;
阴气;;nether energy;;m;;;;
阴阳;;Yin and Yang;;p;;;;
阴阳两仪阵;;Yin-Yang Dualism Formation;;p;;;;
阴阳五行困仙阵;;Yin-Yang Five Elements Immortal Trap;;p;;;;
阴阳五行遁;;Yin-Yang Five Elements Escape;;p;;;;
阴阳洞天;;Yin-Yang Cave Heaven;;p;;;;
阴阳玉髓;;Yin-Yang Jade Marrow;;p;;;;
阴阳虚实;;Yin-Yang Void Stage;;p;;;;
阴阳镜;;Yin-Yang Mirror;;p;;;;
阵旗;;formation flag;;m;;;;
阵法;;Formation;;m;;;;
阵眼;;formation focus;;m;;;;
阿修罗道;;Asura Realm;;p;;;;
阿赖耶识;;Alaya Consciousness;;p;;;;
陆吾;;Luwu (Mountain Guardian);;p;;;;
雪莲;;Saussurea;;p;;;;
雷动九天;;Thunder Shakes Nine Heavens;;p;;;;
雷灵根;;Thunder Spiritual Root;;p;;;;
雷鹏;;Thunder Roc;;p;;;;
雾瀚海;;Ebonmist Sea (of Lava);;p;;;;
青云门;;Azure Cloud Sect;;p;;;;
青元剑诀;;Azure Origin Sword Art;;p;;;;
青城山;;Mount Qingcheng;;p;;;;
青鸾;;Azure Phoenix;;p;;;;
青龙;;Azure Dragon;;p;;;;
青龙印;;Azure Dragon Seal;;p;;;;
顺天应人;;Following Heaven and Responding to Man;;p;;;;
须弥山;;Mount Sumeru;;p;;;;
颠倒五行阵;;Reversed Five Elements Array;;p;;;;
风灵根;;Wind Spiritual Root;;p;;;;
风阴残脉;;Fengyin, Broken Leyline of Winds;;p;;;;
风阴盆地;;Howling Basin;;p;;;;
风雷翅;;Wind Thunder Wings;;p;;;;
风雷阁;;Wind Thunder Pavilion;;p;;;;
飞刀;;Flying Dagger;;p;;;;
飞剑;;Flying Sword;;p;;;;
飞升;;Ascension;;m;;;;
飞轮;;Flying Wheel;;p;;;;
飞针;;Flying Needle;;p;;;;
饕餮;;Taotie (Gluttonous Beast);;p;;;;
饿鬼道;;Preta Realm (Hungry Ghosts);;p;;;;
首乌;;Polygonum Multiflorum;;p;;;;
驭兽术;;Beast Taming Technique;;p;;;;
驻颜丹;;Youth Preserving Pill;;p;;;;
鬣羚;;Serow;;m;;;;
鬼修;;Ghost Cultivator;;p;;;;
鬼气;;Ghost Energy;;p;;;;
鬼骨葬地;;Wraith Boneyard;;p;;;;
魂印;;Soul Seal;;p;;;;
魂印奴役;;Soul Seal Enslavement;;p;;;;
魂契;;Soul Pact;;p;;;;
魂殿;;Soul Hall;;p;;;;
魂灯;;Soul Lamp;;p;;;;
魂牌;;Soul Tablet;;p;;;;
魅力;;Charisma;;m;;;;
魔修;;Devil Cultivator;;m;;;;
魔气;;Devil Energy;;m;;;;
魔炎谷;;Demonic Flame Valley;;p;;;;
魔种;;Demon Seed;;p;;;;
魔道;;Devil Dao;;p;;;;
魔障;;Demonic Barrier;;p;;;;
鵸䳜;;Qiyu (Three-Headed Bird);;p;;;;
鹿芝津;;Evershoal;;m;;;;
麒麟;;Qilin (Chinese Unicorn);;p;;;;
黄云山;;Mount Yellowcloud;;p;;;;
黄枫谷;;Yellow Maple Valley;;p;;;;
黄泉魔脉;;Huangquan, Leyline of Devils;;p;;;;
龙族遗迹;;Dragon Clan Ruins;;p;;;;
龙涎草;;Dragon Saliva Grass;;p;;;;
龙虎山;;Mount Longhu;;p;;;;
龙血石;;Dragon Blood Stone;;p;;;;
龟息功;;Turtle Breathing Art;;p;;;;
薛家;;Xue Family;;m;;;;
崇岳诸脉;;Chongyue Leylines;;m;;;;
天门山;;Mount Empyrean;;m;;;;
霏雪城;;Flakefall City;;m;;;;
尉迟家;;Yuchi Family;;m;;;;"""


# ============================================================================
# Aho-Corasick 自动机：一次扫描找出原文中出现的全部术语
# 不做中文分词 —— 分词器会把「洞天」切进「崇岳洞天」里，术语匹配就失效了
# ============================================================================
class _AC:
    __slots__ = ("goto", "fail", "out")

    def __init__(self):
        self.goto = [{}]
        self.fail = [0]
        self.out = [[]]

    def add(self, word, payload):
        node = 0
        for ch in word:
            nxt = self.goto[node].get(ch)
            if nxt is None:
                self.goto.append({})
                self.fail.append(0)
                self.out.append([])
                nxt = len(self.goto) - 1
                self.goto[node][ch] = nxt
            node = nxt
        self.out[node].append((word, payload))

    def build(self):
        from collections import deque
        q = deque()
        for ch, nxt in self.goto[0].items():
            self.fail[nxt] = 0
            q.append(nxt)
        while q:
            cur = q.popleft()
            for ch, nxt in self.goto[cur].items():
                f = self.fail[cur]
                while f and ch not in self.goto[f]:
                    f = self.fail[f]
                self.fail[nxt] = self.goto[f].get(ch, 0) if f or ch in self.goto[0] else 0
                if self.fail[nxt] == nxt:
                    self.fail[nxt] = 0
                self.out[nxt] = self.out[nxt] + self.out[self.fail[nxt]]
                q.append(nxt)

    def find(self, text):
        node = 0
        for i, ch in enumerate(text):
            while node and ch not in self.goto[node]:
                node = self.fail[node]
            node = self.goto[node].get(ch, 0)
            for word, payload in self.out[node]:
                yield (i - len(word) + 1, i + 1, payload)


_AUTOMATON = None


def _load():
    """解析内联术语库并构建自动机。只在首次调用时执行。"""
    global _AUTOMATON
    if _AUTOMATON is not None:
        return _AUTOMATON
    ac = _AC()
    for line in _GLOSSARY.split("\n"):
        line = line.rstrip("\r")
        if not line:
            continue
        parts = line.split(";;")
        if len(parts) != 5:
            continue
        zh, en, lv, variants, forbidden = parts
        rec = {
            "zh": zh,
            "en": en,
            "lv": lv,
            "forbidden": [x for x in forbidden.split("|") if x],
        }
        for head in [zh] + [x for x in variants.split("|") if x]:
            if len(head) >= 2:          # 单字词条排除，会在「道路」「知道」里误匹配
                ac.add(head, rec)
    ac.build()
    _AUTOMATON = ac
    return ac


def _extract(text):
    """返回按出现顺序去重的命中术语，已做最长匹配过滤。"""
    hits = sorted(_load().find(text), key=lambda h: (h[0], -(h[1] - h[0])))
    seen, order, max_end = {}, [], -1
    for s, e, rec in hits:
        # 起点升序、长度降序排列后，被覆盖与否只取决于已保留匹配的最大终点
        if e <= max_end:                # 「神识能量」命中时不再重复报「神识」
            continue
        max_end = e
        key = rec["zh"]
        if key not in seen:
            seen[key] = 0
            order.append(rec)
        seen[key] += 1
    return order, seen


def main(source_text: str) -> dict:
    """
    入参  source_text : 待译中文原文
    出参  glossary          : 可直接拼进系统提示词的术语表文本
          term_total        : 命中术语总数
          mandatory_count   : 其中必须级数量
          preferred_count   : 其中优先级数量
    """
    text = source_text or ""
    if not text.strip():
        return {"glossary": "", "term_total": 0,
                "mandatory_count": 0, "preferred_count": 0}

    found, counts = _extract(text)
    buckets = {"m": [], "p": [], "r": []}
    for rec in found:
        buckets.get(rec["lv"], buckets["p"]).append(rec)

    out = []
    if buckets["m"]:
        out.append("【必须遵守】以下概念在译文中必须且只能使用「规定译法」，"
                   "括号内的禁用译法一律不得使用：")
        out.append("")
        for r in buckets["m"]:
            line = "- " + r["zh"] + " -> " + r["en"]
            if r["forbidden"]:
                line += "（禁用：" + "、".join(r["forbidden"]) + "）"
            out.append(line)
        out.append("")
    if buckets["p"]:
        out.append("【优先使用】以下译法为首选，允许按语法需要作单复数、时态、词形调整，"
                   "但不得改用其他说法：")
        out.append("")
        for r in buckets["p"]:
            line = "- " + r["zh"] + " -> " + r["en"]
            if r["forbidden"]:
                line += "（禁用：" + "、".join(r["forbidden"]) + "）"
            out.append(line)
        out.append("")
    if buckets["r"]:
        out.append("【参考释义】以下仅供理解原文，译法不作强制要求：")
        out.append("")
        for r in buckets["r"]:
            out.append("- " + r["zh"] + "：" + r["en"])

    return {
        "glossary": "\n".join(out).strip(),
        "term_total": len(found),
        "mandatory_count": len(buckets["m"]),
        "preferred_count": len(buckets["p"]),
    }


# 本地自测：python 本文件.py 原文.txt
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as f:
            src = f.read()
    else:
        src = "崇岳洞天乃是中洲地脉之灵藏身之地，昔年阳和教开山鼻祖误入此间。"
    r = main(src)
    print(r["glossary"])
    print("\n---- 命中 %d 条：必须 %d / 优先 %d ----"
          % (r["term_total"], r["mandatory_count"], r["preferred_count"]))

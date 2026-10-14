玩家的问题：
{{query}}

===============================
RESPONSE CONTEXT
===============================
{{response_context}}

===============================
LORE KNOWLEDGE
===============================
{{lore_context}}

根据玩家的问题、RESPONSE CONTEXT 和 LORE KNOWLEDGE，
按照系统提示词定义的 response_mode 回答玩家。

如果 response_mode = decision，
解释当前状态和可行方案。

如果 response_mode = knowledge，
直接回答对应的游戏知识问题。

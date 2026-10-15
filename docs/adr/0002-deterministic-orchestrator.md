# ADR-0002: Orchestrator deterministik koddur
Durum: Kabul edildi

Görev dağıtımı, bağlam seçimi, round atlama ve bütçe kararları TypeScript kodunda kurallarla verilir.
LLM yalnızca özetleme/kümeleme gibi alt işlerde çağrılır. Sebep: tahmin edilebilirlik, test
edilebilirlik, maliyet.

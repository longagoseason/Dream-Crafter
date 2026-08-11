(function exposeBattleService(root, factory) {
  "use strict";
  const service = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = service;
  if (root) root.BattleService = service;
})(typeof globalThis !== "undefined" ? globalThis : this, function createBattleService() {
  "use strict";

  const clamp = (number, min, max) => Math.min(max, Math.max(min, number));
  const round = (number) => Math.max(0, Math.round(number * 10) / 10);

  function combatStat(unit, key) {
    return (unit[key] ?? 0) + (unit.buffs ?? []).filter((buff) => buff.stat === key).reduce((sum, buff) => sum + buff.value, 0);
  }

  function luckyRollCount(luck, random = Math.random) {
    const guaranteedExtraRolls = Math.floor(Math.max(0, luck) / 100);
    const fractionalChance = Math.max(0, luck) % 100;
    return 1 + guaranteedExtraRolls + (random() * 100 < fractionalChance ? 1 : 0);
  }

  function rollLuckyDamage(actor, damageType, random = Math.random) {
    const attribute = damageType === "physical" ? actor.STR : damageType === "magic" ? actor.INT : 0;
    if (!attribute) return 0;
    const rolls = luckyRollCount(actor.LUK ?? 0, random);
    let best = 0;
    for (let index = 0; index < rolls; index++) best = Math.max(best, attribute * (.1 + random() * .4));
    return round(best);
  }

  function rollCritical(actor, random = Math.random) {
    const isCritical = random() * 100 < clamp(combatStat(actor, "CRI"), 0, 100);
    return { isCritical, multiplier: isCritical ? Math.max(0, combatStat(actor, "CRI_DMG") / 100) : 1 };
  }

  function rollAttackAvoidance(attacker, target, damageType, random = Math.random) {
    const dodgeKey = damageType === "magic" ? "SAR" : "AAR";
    const dodgeChance = clamp(combatStat(target, dodgeKey), 0, 95);
    if (random() * 100 < dodgeChance) return { dodged: true, reason: `${dodgeKey} 閃避`, dodgeChance };
    return { dodged: false, dodgeChance };
  }

  function mitigate(raw, target, defenseKey, attackerLevel, random = Math.random) {
    const defense = combatStat(target, defenseKey);
    const proc = clamp(defense / (attackerLevel * 5), 0, 1);
    const afterProc = random() < proc ? raw * .5 : raw;
    return round(Math.max(1, afterProc - defense / 10));
  }

  function calculateAttackDamage(attacker, target, damageType, baseDamage = 0, skillMultiplier = 1, random = Math.random) {
    const isMagic = damageType === "magic";
    const base = Math.max(0, combatStat(attacker, isMagic ? "MATK" : "ATK"));
    const luckyDamage = rollLuckyDamage(attacker, damageType, random);
    const critical = rollCritical(attacker, random);
    const damageMultiplier = Math.max(0, 1 + combatStat(attacker, isMagic ? "MDAM" : "ADAM") / 100);
    const rawDamage = (base + Number(baseDamage || 0) + luckyDamage) * skillMultiplier * critical.multiplier * damageMultiplier;
    const damage = mitigate(Math.max(1, rawDamage), target, isMagic ? "MR" : "AC", attacker.level, random);
    return { damage, luckyDamage, critical, rawDamage };
  }

  function calculateHeal(actor, baseDamage = 0, multiplier = 1, random = Math.random) {
    const critical = rollCritical(actor, random);
    const amount = (Math.max(0, combatStat(actor, "MATK")) + Number(baseDamage || 0) + combatStat(actor, "WIS") + combatStat(actor, "INT") / 2)
      * multiplier * critical.multiplier * Math.max(0, 1 + combatStat(actor, "MDAM") / 100);
    return { amount: round(amount), critical };
  }

  return { combatStat, luckyRollCount, rollLuckyDamage, rollCritical, rollAttackAvoidance, mitigate, calculateAttackDamage, calculateHeal };
});

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

  function rollLuckyRange(minimum, maximum, luck, random = Math.random) {
    const low = Number(minimum);
    const high = Math.max(low, Number(maximum));
    const rolls = luckyRollCount(luck, random);
    let best = low;
    for (let index = 0; index < rolls; index += 1) {
      best = Math.max(best, low + random() * (high - low));
    }
    return { value: round(best), rolls, minimum: low, maximum: high };
  }

  function rollCritical(actor, random = Math.random) {
    const isCritical = random() * 100 < clamp(combatStat(actor, "CRI"), 0, 100);
    return { isCritical, multiplier: isCritical ? Math.max(0, combatStat(actor, "CRI_DMG") / 100) : 1 };
  }

  function rollAttackAvoidance(attacker, target, damageType, random = Math.random, maximumDodgeChance = 95) {
    if (damageType === "hybrid") {
      const dodgeChance = clamp((combatStat(target, "AAR") + combatStat(target, "SAR")) / 2, 0, 95);
      if (random() * 100 < dodgeChance) return { dodged: true, reason: "Hybrid 閃避", dodgeChance };
      return { dodged: false, dodgeChance };
    }
    const dodgeKey = damageType === "magic" ? "SAR" : "AAR";
    const configuredMaximum = Number(maximumDodgeChance);
    const dodgeMaximum = Number.isFinite(configuredMaximum) ? clamp(configuredMaximum, 0, 100) : 95;
    const dodgeChance = clamp(combatStat(target, dodgeKey), 0, dodgeMaximum);
    if (random() * 100 < dodgeChance) return { dodged: true, reason: `${dodgeKey} 閃避`, dodgeChance };
    return { dodged: false, dodgeChance };
  }

  function mitigate(raw, target, defenseKey, attackerLevel, random = Math.random, armorRate = 2) {
    const defense = combatStat(target, defenseKey);
    const level = Math.max(1, Number(attackerLevel) || 1);
    const divisor = Number(armorRate);
    const safeArmorRate = Number.isFinite(divisor) && divisor > 0 ? divisor : 2;
    const proc = clamp(defense / (level * 5) * .5, 0, .5);
    const afterProc = random() < proc ? raw * .5 : raw;
    return round(Math.max(1, afterProc - defense / safeArmorRate));
  }

  function calculateAttackDamage(attacker, target, damageType, baseDamage = 0, skillMultiplier = 1, random = Math.random, armorRate = 2) {
    if (damageType === "hybrid") {
      const atk = Math.max(0, combatStat(attacker, "ATK"));
      const matk = Math.max(0, combatStat(attacker, "MATK"));
      const minimum = atk * .6 + matk * .6 + Number(baseDamage || 0);
      const maximum = atk * .8 + matk * .8 + Number(baseDamage || 0)
        + Math.max(0, combatStat(attacker, "STR")) * .7
        + Math.max(0, combatStat(attacker, "INT")) * .7;
      const roll = rollLuckyRange(minimum, maximum, combatStat(attacker, "LUK"), random);
      const critical = rollCritical(attacker, random);
      const hybridBonus = (combatStat(attacker, "ADAM") + combatStat(attacker, "MDAM")) * .7;
      const rawDamage = roll.value * skillMultiplier * critical.multiplier * Math.max(0, 1 + hybridBonus / 100);
      const ac = combatStat(target, "AC");
      const mr = combatStat(target, "MR");
      const defenseForProc = (ac + mr) / 2;
      const level = Math.max(1, Number(attacker.level) || 1);
      const halfChance = clamp(defenseForProc / (level * 5) * .5, 0, .5);
      const afterProc = random() < halfChance ? rawDamage * .5 : rawDamage;
      const divisor = Number(armorRate);
      const safeArmorRate = Number.isFinite(divisor) && divisor > 0 ? divisor : 2;
      const damage = round(Math.max(1, afterProc - (ac + mr) / safeArmorRate));
      return { damage, roll, critical, rawDamage, hybridBonus, halfChance };
    }
    const isMagic = damageType === "magic";
    const base = Math.max(0, combatStat(attacker, isMagic ? "MATK" : "ATK"));
    const attribute = Math.max(0, combatStat(attacker, isMagic ? "INT" : "STR"));
    const minimum = base + Number(baseDamage || 0);
    const roll = rollLuckyRange(minimum, minimum + attribute, combatStat(attacker, "LUK"), random);
    const critical = rollCritical(attacker, random);
    const damageMultiplier = Math.max(0, 1 + combatStat(attacker, isMagic ? "MDAM" : "ADAM") / 100);
    const rawDamage = roll.value * skillMultiplier * critical.multiplier * damageMultiplier;
    const damage = mitigate(Math.max(1, rawDamage), target, isMagic ? "MR" : "AC", attacker.level, random, armorRate);
    return { damage, roll, critical, rawDamage };
  }

  function calculateHeal(actor, baseDamage = 0, multiplier = 1, random = Math.random) {
    const minimum = Math.max(0, combatStat(actor, "MATK")) + Number(baseDamage || 0);
    const maximum = minimum + Math.max(0, combatStat(actor, "WIS") + combatStat(actor, "INT") / 2);
    const roll = rollLuckyRange(minimum, maximum, combatStat(actor, "LUK"), random);
    const critical = rollCritical(actor, random);
    const amount = roll.value * multiplier * critical.multiplier * Math.max(0, 1 + combatStat(actor, "MDAM") / 100);
    return { amount: round(amount), roll, critical };
  }

  return { combatStat, luckyRollCount, rollLuckyRange, rollCritical, rollAttackAvoidance, mitigate, calculateAttackDamage, calculateHeal };
});

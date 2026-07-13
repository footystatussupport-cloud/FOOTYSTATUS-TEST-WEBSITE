// JS mirror of the substitution-rule validator (see the SQL function
// validate_match_substitution). Given a league config + the player's existing
// on/off events + the proposed new event, returns an array of violation codes.
export function validateSub({ config, duration, existing, proposed }) {
  // existing: [{minute,type}] for the player, chronological. type in
  // sub_in/sub_out/injury/red_card. proposed: {minute,type}
  const v = [];
  const m = proposed.minute;
  if (m == null || m < 0) v.push("minute_before_kickoff");
  if (m != null && m > duration) v.push("minute_after_final_whistle");

  // Reconstruct on-field state and history up to now.
  let onField = false, everRed = false, subInCount = 0, subOutCount = 0;
  for (const e of existing) {
    if (e.type === "sub_in") { onField = true; subInCount++; }
    else if (e.type === "sub_out") { onField = false; subOutCount++; }
    else if (e.type === "injury") { onField = false; }
    else if (e.type === "red_card") { onField = false; everRed = true; }
  }

  if (proposed.type === "sub_in") {
    if (everRed) v.push("red_carded_cannot_return");
    if (onField) v.push("already_on_field");           // in twice without out
    if (subOutCount > 0 && !config.allowReentry) v.push("reentry_not_allowed");
    // team-wide sub limit (in = one substitution used)
    if (config.maxSubstitutions != null && config.usedSubs >= config.maxSubstitutions)
      v.push("sub_limit_reached");
  }
  if (proposed.type === "sub_out") {
    if (!onField) v.push("not_on_field_cannot_leave");
  }
  return v;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const D = 90;
  const base = { config: { allowReentry: false, maxSubstitutions: 5, usedSubs: 0 }, duration: D };
  const cases = [
    ["sub_in valid", { ...base, existing: [], proposed: { minute: 60, type: "sub_in" } }, []],
    ["sub_in after final whistle", { ...base, existing: [], proposed: { minute: 95, type: "sub_in" } }, ["minute_after_final_whistle"]],
    ["sub_in before kickoff", { ...base, existing: [], proposed: { minute: -1, type: "sub_in" } }, ["minute_before_kickoff"]],
    ["re-entry blocked (out then in, no reentry)", { ...base, existing: [{minute:20,type:"sub_in"},{minute:40,type:"sub_out"}], proposed: { minute: 60, type: "sub_in" } }, ["reentry_not_allowed"]],
    ["re-entry allowed", { config:{allowReentry:true,maxSubstitutions:null,usedSubs:0}, duration:D, existing: [{minute:20,type:"sub_in"},{minute:40,type:"sub_out"}], proposed: { minute: 60, type: "sub_in" } }, []],
    ["red-carded cannot return", { ...base, existing: [{minute:30,type:"red_card"}], proposed: { minute: 55, type: "sub_in" } }, ["red_carded_cannot_return"]],
    ["already on field (in twice)", { ...base, existing: [{minute:20,type:"sub_in"}], proposed: { minute: 40, type: "sub_in" } }, ["already_on_field"]],
    ["sub limit reached (6th)", { config:{allowReentry:false,maxSubstitutions:5,usedSubs:5}, duration:D, existing: [], proposed: { minute: 70, type: "sub_in" } }, ["sub_limit_reached"]],
    ["sub_out when not on field", { ...base, existing: [], proposed: { minute: 50, type: "sub_out" } }, ["not_on_field_cannot_leave"]],
  ];
  let pass = true;
  for (const [name, input, expect] of cases) {
    const got = validateSub(input).sort();
    const ok = JSON.stringify(got) === JSON.stringify([...expect].sort());
    if (!ok) pass = false;
    console.log((ok?"PASS":"FAIL").padEnd(5), name.padEnd(44), "=>", JSON.stringify(got), ok?"":`(expected ${JSON.stringify(expect)})`);
  }
  process.exit(pass?0:1);
}

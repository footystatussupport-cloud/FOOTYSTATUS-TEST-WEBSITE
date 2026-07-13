function computeMinutes({ started, duration, events }) {
  let open = started ? 0 : null;
  let total = 0, terminated = false;
  for (const e of events) {
    if (terminated) continue;
    const m = e.minute ?? 0;
    if (e.type === "sub_in") {
      if (open === null) open = m;
    } else if (e.type === "sub_out" || e.type === "injury") {
      if (open !== null) { total += Math.max(m - open, 0); open = null; }
    } else if (e.type === "red_card") {
      if (open !== null) { total += Math.max(m - open, 0); open = null; }
      terminated = true;
    }
  }
  if (open !== null && !terminated) total += Math.max(duration - open, 0);
  return Math.min(total, duration);
}
const D = 90;
const cases = [
  ["Starter, never removed (90)",        { started:true,  duration:D, events:[] }, 90],
  ["Starter subbed out at 60",           { started:true,  duration:D, events:[{minute:60,type:"sub_out"}] }, 60],
  ["Sub in at 65, stays to end",         { started:false, duration:D, events:[{minute:65,type:"sub_in"}] }, 25],
  ["Sub in at 30, out at 75",            { started:false, duration:D, events:[{minute:30,type:"sub_in"},{minute:75,type:"sub_out"}] }, 45],
  ["Starter red card at 40",             { started:true,  duration:D, events:[{minute:40,type:"red_card"}] }, 40],
  ["Starter injury removal at 55",       { started:true,  duration:D, events:[{minute:55,type:"injury"}] }, 55],
  ["Re-entry start,out20,in35,out60",    { started:true,  duration:D, events:[{minute:20,type:"sub_out"},{minute:35,type:"sub_in"},{minute:60,type:"sub_out"}] }, 45],
  ["Bench, never enters (0)",            { started:false, duration:D, events:[] }, 0],
  ["70-min match starter",               { started:true,  duration:70, events:[] }, 70],
  ["Red card after re-entry, later in ignored", { started:true, duration:D, events:[{minute:20,type:"sub_out"},{minute:30,type:"sub_in"},{minute:50,type:"red_card"},{minute:70,type:"sub_in"}] }, 40],
];
let pass = true;
for (const [name, input, expect] of cases) {
  const got = computeMinutes(input);
  const ok = got === expect;
  if (!ok) pass = false;
  console.log((ok?"PASS":"FAIL").padEnd(5), name.padEnd(44), "=>", String(got).padStart(3), ok?"":`(expected ${expect})`);
}
process.exit(pass?0:1);

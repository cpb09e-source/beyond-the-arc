/**
 * build-conferences-2027.mjs — one-time: emit src/data/conferences-2027.json,
 * a { ourTeamName: conferenceDisplayName } map for the 2026-27 alignment (Bart's
 * stored conference reflects 2025-26). Source: the realignment table Colin
 * provided. Teams listed in two leagues are resolved to their BASKETBALL home
 * here (Army→Patriot, Oregon→Big Ten, Hawaii/UC Davis→Big West, Delaware→CUSA,
 * Tennessee Tech→OVC). A handful of our teams the table omitted are filled from
 * UNLISTED below.
 *
 * Run: node scripts/build-conferences-2027.mjs
 */
import fs from "node:fs";
import path from "node:path";

// Conference display name → member teams (as written in the source table).
const TABLE = {
  "ACC": ["Boston College","California","Clemson","Duke","Florida State","Georgia Tech","Louisville","Miami (FL)","NC State","North Carolina","Notre Dame","Pittsburgh","SMU","Stanford","Syracuse","Virginia","Virginia Tech","Wake Forest"],
  "America East": ["Albany","Binghamton","Bryant","Maine","New Hampshire","NJIT","UMass Lowell","UMBC","Vermont"],
  "American Athletic": ["Charlotte","East Carolina","Florida Atlantic","Memphis","North Texas","Rice","South Florida","Temple","Tulane","Tulsa","UAB","UTSA","Wichita State"],
  "ASUN": ["Bellarmine","Eastern Illinois","Florida Gulf Coast","Jacksonville","Lipscomb","Queens","Stetson","North Florida","West Georgia"],
  "Atlantic 10": ["Davidson","Dayton","Duquesne","Fordham","George Washington","George Mason","La Salle","Loyola Chicago","Massachusetts","Rhode Island","Richmond","Saint Joseph's","Saint Louis","St. Bonaventure","VCU"],
  "Big 12": ["Arizona","Arizona State","Baylor","BYU","Cincinnati","Colorado","Houston","Iowa State","Kansas","Kansas State","Oklahoma State","TCU","Texas Tech","UCF","Utah","West Virginia"],
  "Big East": ["Butler","Creighton","DePaul","Georgetown","Marquette","Providence","Seton Hall","St. John's","UConn","Villanova","Xavier"],
  "Big Sky": ["Eastern Washington","Idaho","Idaho State","Montana","Montana State","Northern Arizona","Northern Colorado","Portland State","Southern Utah","Utah Tech","Weber State"],
  "Big South": ["Charleston Southern","Gardner-Webb","High Point","Longwood","Presbyterian","Radford","UNC Asheville","USC Upstate","Winthrop"],
  "Big Ten": ["Illinois","Indiana","Iowa","Maryland","Michigan","Michigan State","Minnesota","Nebraska","Northwestern","Ohio State","Oregon","Penn State","Purdue","Rutgers","UCLA","USC","Washington","Wisconsin"],
  "Big West": ["Cal Poly","Cal State Bakersfield","Cal State Fullerton","California Baptist","Hawaii","Long Beach State","Sacramento State","UC Davis","UC Irvine","UC Riverside","UC San Diego","UC Santa Barbara"],
  "Coastal Athletic": ["Campbell","Charleston","Delaware","Drexel","Elon","Hampton","Hofstra","Monmouth","North Carolina A&T","Northeastern","Stony Brook","Towson","UNC Wilmington","William & Mary"],
  "Conference USA": ["Delaware","FIU","Jacksonville State","Kennesaw State","Liberty","Middle Tennessee","Missouri State","New Mexico State","Sam Houston"],
  "Horizon League": ["Cleveland State","Green Bay","IU Indianapolis","Milwaukee","Northern Illinois","Northern Kentucky","Oakland","Purdue Fort Wayne","Robert Morris","Wright State","Youngstown State","Detroit Mercy"],
  "Ivy League": ["Brown","Columbia","Cornell","Dartmouth","Harvard","Penn","Princeton","Yale"],
  "MAAC": ["Canisius","Fairfield","Iona","Manhattan","Marist","Merrimack","Mount St. Mary's","Niagara","Quinnipiac","Rider","Sacred Heart","Saint Peter's","Siena"],
  "MAC": ["Akron","Ball State","Bowling Green","Buffalo","Central Michigan","Eastern Michigan","Kent State","Miami (OH)","Ohio","Toledo","UMass","Western Michigan"],
  "MEAC": ["Coppin State","Delaware State","Howard","Maryland Eastern Shore","Morgan State","Norfolk State","North Carolina Central","South Carolina State"],
  "Missouri Valley": ["Belmont","Bradley","Drake","Evansville","Illinois State","Indiana State","Murray State","Northern Iowa","Southern Illinois","UIC","Valparaiso"],
  "Mountain West": ["Grand Canyon","Hawaii","Nevada","New Mexico","San José State","UC Davis","UTEP","Wyoming","Air Force","UNLV"],
  "Northeast": ["Central Connecticut","Chicago State","Fairleigh Dickinson","Le Moyne","LIU","Mercyhurst","New Haven","Saint Francis","Stonehill","Wagner"],
  "Ohio Valley": ["Lindenwood","Little Rock","Morehead State","SIUE","Southeast Missouri State","Southern Indiana","Tennessee State","Tennessee Tech","UT Martin","Western Illinois"],
  "Patriot League": ["American","Boston University","Bucknell","Colgate","Holy Cross","Lafayette","Lehigh","Loyola Maryland","Navy","Army"],
  "Pac-12": ["Boise State","Colorado State","Fresno State","Gonzaga","Oregon State","San Diego State","Texas State","Utah State","Washington State"],
  "SEC": ["Alabama","Arkansas","Auburn","Florida","Georgia","Kentucky","LSU","Mississippi State","Missouri","Oklahoma","Ole Miss","South Carolina","Tennessee","Texas","Texas A&M","Vanderbilt"],
  "Southern Conference": ["Chattanooga","The Citadel","East Tennessee State","Furman","Mercer","Samford","UNC Greensboro","VMI","Western Carolina","Wofford"],
  "Southland": ["Houston Christian","Incarnate Word","Lamar","McNeese","New Orleans","Nicholls","Northwestern State","Southeastern Louisiana","Stephen F. Austin","Texas A&M–Corpus Christi","UT Rio Grande Valley"],
  "Summit League": ["Kansas City","North Dakota","North Dakota State","Omaha","Oral Roberts","St. Thomas","South Dakota","South Dakota State"],
  "Sun Belt": ["Appalachian State","Arkansas State","Coastal Carolina","Georgia Southern","Georgia State","James Madison","Louisiana","Louisiana Monroe","Marshall","Old Dominion","South Alabama","Southern Miss","Troy","Louisiana Tech"],
  "SWAC": ["Alabama A&M","Alabama State","Alcorn State","Arkansas–Pine Bluff","Bethune-Cookman","Florida A&M","Grambling State","Jackson State","Mississippi Valley State","Prairie View A&M","Southern","Texas Southern"],
  "United Athletic": ["Abilene Christian","Austin Peay","Central Arkansas","Eastern Kentucky","North Alabama","Tarleton State","UT Arlington","West Georgia","Utah Valley"],
  "West Coast": ["Denver","Loyola Marymount","Pacific","Pepperdine","Portland","Saint Mary's","San Diego","San Francisco","Santa Clara","Seattle"],
};

// Source-table names → our Bart team names, where normalization can't bridge them.
const ALIAS = {
  "SIUE": "SIU Edwardsville",
  "IU Indianapolis": "IU Indy",
  "Texas A&M–Corpus Christi": "Texas A&M Corpus Chris",
  "UT Martin": "Tennessee Martin",
  "Kansas City": "UMKC",
  "Omaha": "Nebraska Omaha",
  "Loyola Maryland": "Loyola MD",
  "Nicholls": "Nicholls St.",
  "McNeese": "McNeese St.",
  "California Baptist": "Cal Baptist",
  "Ole Miss": "Mississippi",
  "UConn": "Connecticut",
  "UMass": "Massachusetts",
  "UIC": "Illinois Chicago",
  "Seattle": "Seattle",
  "West Georgia": "West Georgia",
  "Sam Houston": "Sam Houston St.",
};

// Our teams the source table omitted entirely — assigned from their known
// 2026-27 basketball conference.
const UNLISTED = {
  "Cal St. Northridge": "Big West",
  "East Texas A&M": "Southland",
  "Western Kentucky": "Conference USA",
};

const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/&/g, "").replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "");

const DATA = path.resolve("public/data");
const OUT = path.resolve("src/data/conferences-2027.json");

const teams = JSON.parse(fs.readFileSync(path.join(DATA, "teams-all.json"), "utf8"));
const arr = Array.isArray(teams) ? teams : teams.teams ?? [];
const latest = arr.reduce((m, t) => Math.max(m, t.year), 0);
const ourNames = [...new Set(arr.filter((t) => t.year === latest).map((t) => t.name))];
const ourByNorm = new Map(ourNames.map((n) => [norm(n), n]));

const confByTeam = {};
const tableUnmatched = [];
for (const [conf, members] of Object.entries(TABLE)) {
  for (const m of members) {
    const our = ALIAS[m] ? (ourByNorm.get(norm(ALIAS[m])) ?? ALIAS[m]) : ourByNorm.get(norm(m));
    if (!our) { tableUnmatched.push(`${m} (${conf})`); continue; }
    confByTeam[our] = conf;
  }
}

for (const [team, conf] of Object.entries(UNLISTED)) if (ourByNorm.has(norm(team))) confByTeam[ourByNorm.get(norm(team))] = conf;

const ourUnassigned = ourNames.filter((n) => !confByTeam[n]).sort();

fs.writeFileSync(OUT, JSON.stringify(confByTeam, null, 0));
console.log(`✓ wrote ${OUT} — ${Object.keys(confByTeam).length}/${ourNames.length} teams assigned`);
if (tableUnmatched.length) console.log(`\n⚠ table names not matched to our teams (${tableUnmatched.length}):\n  ${tableUnmatched.join("\n  ")}`);
if (ourUnassigned.length) console.log(`\n⚠ our teams with NO 26-27 conference (${ourUnassigned.length}):\n  ${ourUnassigned.join(", ")}`);

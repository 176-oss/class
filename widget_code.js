// ⚙️ 본인의 Vercel 주소를 입력하세요 (뒤에 /api 꼭 확인!)
const VERCEL_URL = "https://edutime-api.vercel.app/api"; 

const CLASS_COLORS = [
  "#3498db", "#e74c3c", "#2ecc71", "#f1c40f", "#9b59b6", 
  "#1abc9c", "#e67e22", "#e84393", "#00cec9", "#ffeaa7",
  "#6c5ce7", "#ff7675", "#55efc4", "#fdcb6e", "#a29bfe",
  "#00b894", "#0984e3", "#d63031", "#e17055", "#b2bec3"
];

const PASTEL_SUBJECT_COLORS = [
    "#9DD9E8", "#F9BBD1", "#EEDC7D", "#B9D864", "#D8CAEE"
];

// ✨ [신규] iOS 표준 시작 시간표 세팅
const START_TIMES = ["09:00", "10:00", "11:00", "12:00", "13:50", "14:50", "15:50"];

let SCHOOL_NAME = Keychain.contains("SCHOOL_NAME") ? Keychain.get("SCHOOL_NAME") : "";
let TEACHER_NAME = Keychain.contains("TEACHER_NAME") ? Keychain.get("TEACHER_NAME") : "";

if (SCHOOL_NAME.includes("여기에") || SCHOOL_NAME === "") SCHOOL_NAME = "";
if (TEACHER_NAME.includes("여기에") || TEACHER_NAME === "") TEACHER_NAME = "";

let WEEK_OFFSET = 0;
if (config.runsInWidget && args.widgetParameter) {
  WEEK_OFFSET = parseInt(args.widgetParameter);
  if (isNaN(WEEK_OFFSET)) WEEK_OFFSET = 0;
}

if (args.queryParameters && args.queryParameters.action === "settings") {
  await showSetupWizard();
} else if (!config.runsInWidget && (!SCHOOL_NAME || !TEACHER_NAME)) {
  await showSetupWizard();
}

let widget = new ListWidget();

// ✨ [신규] 기기에 저장된 투명도(Opacity) 설정을 가져와 배경색에 투명 알파 기둥 연결
let opacityPct = Keychain.contains("WIDGET_OPACITY") ? Keychain.get("WIDGET_OPACITY") : "100";
let alphaValue = parseInt(opacityPct) / 100;
widget.backgroundColor = new Color("#1c1c1e", alphaValue); 
widget.setPadding(12, 16, 12, 16); 

if (!SCHOOL_NAME || !TEACHER_NAME) {
  let t = widget.addText("⚠️ 앱을 열어 설정을 완료해주세요.");
  t.textColor = Color.white();
  t.font = Font.systemFont(12);
} else {
  let scheduleData = null;
  let errorMsg = "";
  try {
    scheduleData = await fetchSchedule();
    if (scheduleData && (scheduleData.error || scheduleData.message)) {
      errorMsg = scheduleData.error || scheduleData.message;
    }
  } catch (e) {
    errorMsg = "서버 응답 없음";
  }
  
  if (errorMsg.includes("데이터가 없습니다")) {
    errorMsg = "학교에서 아직 시간표를 생성하지 않았습니다.";
  }
  
  if ((!scheduleData || errorMsg)) { 
      let backupData = loadSpecificBackup(WEEK_OFFSET);
      if (backupData && !backupData.error) {
          scheduleData = backupData;
          errorMsg = `오프라인 모드 (백업)`;
      } else {
          errorMsg = "네트워크 오류 & 백업 없음";
          scheduleData = null;
      }
  }

  buildWidget(widget, scheduleData, errorMsg);
}

if (config.runsInWidget) Script.setWidget(widget);
else widget.presentLarge(); 
Script.complete();

// ==========================================
// 📂 파일 매니저
// ==========================================
function getBackupDirectory() {
  let fm = FileManager.local();
  let dir = fm.joinPath(fm.documentsDirectory(), "edutime_backups");
  if (!fm.fileExists(dir)) fm.createDirectory(dir);
  return { fm, dir };
}

function cleanOldBackups() {
  let { fm, dir } = getBackupDirectory();
  let files = fm.listContents(dir);
  let now = new Date();
  
  for (let file of files) {
    let filePath = fm.joinPath(dir, file);
    let creationDate = fm.creationDate(filePath);
    let diffDays = (now.getTime() - creationDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 14) fm.remove(filePath);
  }
}

function saveBackupIfNeeded(data, targetWeekOffset) {
  if (!data || data.error || !Array.isArray(data) || data.length !== 5) return;
  
  let now = new Date();
  let d = new Date(now);
  let dayOfWeek = now.getDay();
  
  let distance = 5 - dayOfWeek;
  d.setDate(d.getDate() + distance);
  d.setDate(d.getDate() + (targetWeekOffset * 7));
  
  let dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  let safeSchool = SCHOOL_NAME.replace(/[^a-zA-Z0-9가-힣]/g, "");
  let safeTeacher = TEACHER_NAME.replace(/[^a-zA-Z0-9가-힣]/g, "");
  
  let fileName = `backup_${safeSchool}_${safeTeacher}_${dateStr}.json`;
  let { fm, dir } = getBackupDirectory();
  let filePath = fm.joinPath(dir, fileName);
  
  fm.writeString(filePath, JSON.stringify(data));
}

function loadSpecificBackup(targetWeekOffset) {
  let { fm, dir } = getBackupDirectory();
  let files = fm.listContents(dir);
  
  let safeSchool = SCHOOL_NAME.replace(/[^a-zA-Z0-9가-힣]/g, "");
  let safeTeacher = TEACHER_NAME.replace(/[^a-zA-Z0-9가-힣]/g, "");
  let prefix = `backup_${safeSchool}_${safeTeacher}_`;
  
  let targetFiles = files.filter(f => f.startsWith(prefix));
  if (targetFiles.length === 0) return { error: "백업 없음" };
  
  let now = new Date();
  let dayOfWeek = now.getDay();
  let currentWeekFriday = new Date(now);
  let distance = 5 - dayOfWeek;
  currentWeekFriday.setDate(now.getDate() + distance);
  currentWeekFriday.setDate(currentWeekFriday.getDate() + (targetWeekOffset * 7));
  
  let targetDateStr = `${currentWeekFriday.getFullYear()}${String(currentWeekFriday.getMonth()+1).padStart(2,'0')}${String(currentWeekFriday.getDate()).padStart(2,'0')}`;
  let matchFileName = `${prefix}${targetDateStr}.json`;
  
  if (targetFiles.includes(matchFileName)) {
      let filePath = fm.joinPath(dir, matchFileName);
      return JSON.parse(fm.readString(filePath));
  }
  
  targetFiles.sort();
  let latestFile = targetFiles.pop(); 
  let filePath = fm.joinPath(dir, latestFile);
  return JSON.parse(fm.readString(filePath));
}

// ==========================================
// 🌐 네트워크 로직
// ==========================================
async function fetchSchedule() {
  cleanOldBackups();

  if (WEEK_OFFSET < 0) {
      let backup = loadSpecificBackup(WEEK_OFFSET);
      if (backup && !backup.error) return backup;
      else throw new Error("백업 없음");
  }

  let url = `${VERCEL_URL}?school=${encodeURIComponent(SCHOOL_NAME)}&teacher=${encodeURIComponent(TEACHER_NAME)}&week=${WEEK_OFFSET}`;
  let req = new Request(url);
  req.timeoutInterval = 5; 
  let res = await req.loadJSON(); 
  
  if (!res.error) {
      saveBackupIfNeeded(res, WEEK_OFFSET);
  }
  
  if (WEEK_OFFSET === 0) {
    let now = new Date();
    if ((now.getDay() === 5 && now.getHours() >= 16) || now.getDay() === 6 || now.getDay() === 0) {
        try {
            let nextUrl = `${VERCEL_URL}?school=${encodeURIComponent(SCHOOL_NAME)}&teacher=${encodeURIComponent(TEACHER_NAME)}&week=1`;
            let nextReq = new Request(nextUrl);
            nextReq.timeoutInterval = 4;
            let nextRes = await nextReq.loadJSON();
            saveBackupIfNeeded(nextRes, 1); 
        } catch(e) {}
    }
  }
  
  return res;
}

// ==========================================
// ⚙️ 설정 마법사 (투명도 추가 빌드 ✨)
// ==========================================
async function showSetupWizard() {
  let a1 = new Alert();
  a1.title = "1. 학교 검색 🏫";
  a1.message = "학교 이름의 일부를 입력하세요.";
  let cleanSchoolName = SCHOOL_NAME ? SCHOOL_NAME.split(" (")[0] : "";
  a1.addTextField("학교명", cleanSchoolName);
  a1.addAction("검색");
  a1.addCancelAction("취소");
  if (await a1.presentAlert() === -1) return;
  
  let searchWord = a1.textFieldValue(0).trim();
  if (!searchWord) return;

  let schools = [];
  try {
    let req = new Request(`${VERCEL_URL}?action=search_schools&school=${encodeURIComponent(searchWord)}`);
    let res = await req.loadJSON();
    schools = res.schools || [];
  } catch(e) {
    let err = new Alert(); err.title = "⚠️ 연결 실패"; err.addAction("확인"); await err.presentAlert(); return;
  }

  if (schools.length === 0) {
    let err = new Alert(); err.title = "결과 없음"; err.addAction("확인"); await err.presentAlert(); return;
  }

  let selectedSchool = String(schools[0]);
  if (schools.length > 1) {
    let a2 = new Alert();
    a2.title = "2. 정확한 학교 선택 👆";
    for (let s of schools) a2.addAction(String(s));
    a2.addCancelAction("취소");
    let selIdx = await a2.presentSheet(); 
    if (selIdx === -1) return;
    selectedSchool = String(schools[selIdx]);
  }

  let displaySchool = selectedSchool.split(" (")[0];
  let a3 = new Alert();
  a3.title = "3. 교사 검색 🔍";
  a3.message = `[${displaySchool}]\n선생님 성함을 입력하세요.`;
  a3.addTextField("교사명", TEACHER_NAME);
  a3.addAction("검색");
  a3.addCancelAction("취소");
  if (await a3.presentAlert() === -1) return;

  let searchTeacher = a3.textFieldValue(0).trim();

  let teachers = [];
  try {
    let tReq = new Request(`${VERCEL_URL}?action=get_teachers&school=${encodeURIComponent(selectedSchool)}`);
    let tRes = await tReq.loadJSON();
    teachers = tRes.teachers || [];
  } catch (e) {
    let err = new Alert(); err.title = "⚠️ 명단 로드 실패"; err.addAction("확인"); await err.presentAlert(); return;
  }
  
  let filteredTeachers = teachers;
  if (searchTeacher) {
    filteredTeachers = teachers.filter(t => String(t).includes(searchTeacher));
    if (filteredTeachers.length === 0 && searchTeacher.length >= 2) {
      let shortName = searchTeacher.substring(0, 2);
      filteredTeachers = teachers.filter(t => String(t).includes(shortName));
    }
  }

  if (filteredTeachers.length === 0) {
     let err = new Alert(); err.title = "교사 없음"; err.addAction("확인"); await err.presentAlert(); return;
  }

  let selectedTeacher = String(filteredTeachers[0]);
  if (filteredTeachers.length > 1) {
    let a4 = new Alert();
    a4.title = "4. 교사 최종 선택 👆";
    for (let t of filteredTeachers) a4.addAction(String(t));
    a4.addCancelAction("취소");
    let tSelIdx = await a4.presentSheet();
    if (tSelIdx === -1) return;
    selectedTeacher = String(filteredTeachers[tSelIdx]);
  }

  // ✨ [신규 요청] 5단계: 투명도 직접 입력 UI 추가
  let a5 = new Alert();
  a5.title = "5. 위젯 투명도 설정 🌓";
  a5.message = "위젯의 배경 투명도를 고르세요.";
  a5.addAction("0% (완전 투명 배경)");
  a5.addAction("30% (투명함)");
  a5.addAction("60% (은은하게 비침)");
  a5.addAction("100% (원래 불투명 배경)");
  let opIdx = await a5.presentAlert();
  let opacityValue = "100";
  if (opIdx === 0) opacityValue = "0";
  else if (opIdx === 1) opacityValue = "30";
  else if (opIdx === 2) opacityValue = "60";
  else opacityValue = "100";

  SCHOOL_NAME = selectedSchool;
  TEACHER_NAME = selectedTeacher;
  Keychain.set("SCHOOL_NAME", SCHOOL_NAME);
  Keychain.set("TEACHER_NAME", TEACHER_NAME);
  Keychain.set("WIDGET_OPACITY", opacityValue); // 투명도 키체인에 기록
  
  let success = new Alert();
  success.title = "🎉 설정 완료!";
  success.message = `[${displaySchool}]\n[${TEACHER_NAME}] 위젯 설정 및 투명도(${opacityValue}%)가 저장되었습니다.`;
  success.addAction("확인");
  await success.presentAlert();
}

// ==========================================
// 🎨 화면 최종 빌드
// ==========================================
function buildWidget(widget, schedule, errorMsg) {
  let headerStack = widget.addStack();
  headerStack.centerAlignContent();
  
  let myScriptName = encodeURIComponent(Script.name());
  let weekLabelText = "[이번 주] ";
  let labelColor = Color.white();
  
  if (WEEK_OFFSET === -1) {
    weekLabelText = "[지나간 주] ";
    labelColor = new Color("#8e8e93"); 
  } else if (WEEK_OFFSET === 1) {
    weekLabelText = "[다음 주] ";
    labelColor = new Color("#ffcc00"); 
  }

  let weekLabel = headerStack.addText(weekLabelText);
  weekLabel.font = Font.boldSystemFont(12);
  weekLabel.textColor = labelColor;

  let titleText = headerStack.addText(`👨‍🏫 ${TEACHER_NAME}`);
  titleText.font = Font.boldSystemFont(12); 
  titleText.textColor = Color.white();
  headerStack.addSpacer();
  
  let setBtn = headerStack.addStack();
  setBtn.backgroundColor = new Color("#333333");
  setBtn.cornerRadius = 4;
  setBtn.setPadding(2, 6, 2, 6);
  let setText = setBtn.addText("⚙️");
  setText.font = Font.systemFont(10);
  setBtn.url = `scriptable:///run/${myScriptName}?action=settings`;

  widget.addSpacer(10); 

  let gridStack = widget.addStack();
  gridStack.layoutHorizontally();
  const days = ["월", "화", "수", "목", "금"];
  
  let uniqueClasses = new Set();
  let subjectCounts = {};
  
  if (schedule && !errorMsg) {
      for (let d = 0; d < 5; d++) {
          let dayData = schedule[d] || schedule[String(d)];
          if (dayData) {
              for (let p = 0; p < 7; p++) {
                  let cellData = dayData[p];
                  let cellText = (cellData && cellData.subject) ? cellData.subject : "-";
                  let cleanText = cellText.replace("(휴강)", "").trim();
                  if (cleanText !== "-") {
                      let parts = cleanText.split(" ");
                      let classKeyMatch = parts[0].match(/(\d+-\d+)/);
                      if (classKeyMatch) uniqueClasses.add(classKeyMatch[1]);
                      let subjTextStr = parts.slice(1).join(" ").replace(" ", "/").replace(",", "/");
                      if (subjTextStr) subjectCounts[subjTextStr] = (subjectCounts[subjTextStr] || 0) + 1;
                  }
              }
          }
      }
  }
  
  let sortedClasses = Array.from(uniqueClasses).sort();
  let classColorMap = {};
  sortedClasses.forEach((clazz, index) => {
      classColorMap[clazz] = CLASS_COLORS[index % CLASS_COLORS.length];
  });
  
  let sortedSubjectsByFreq = Object.keys(subjectCounts).sort((a, b) => subjectCounts[b] - subjectCounts[a]);
  let subjectColorMap = {};
  sortedSubjectsByFreq.forEach((subj, index) => {
      if (index === 0) subjectColorMap[subj] = "#FFFFFF"; 
      else subjectColorMap[subj] = PASTEL_SUBJECT_COLORS[(index - 1) % PASTEL_SUBJECT_COLORS.length];
  });

  // ────────────────────────────────────────────────────────
  // ✨ [신규 요청] 맨 왼쪽 교시 및 시작 시간 축 컬럼 생성
  // ────────────────────────────────────────────────────────
  let timeStack = gridStack.addStack();
  timeStack.layoutVertically();
  
  let timeHeaderStack = timeStack.addStack();
  timeHeaderStack.layoutHorizontally();
  timeHeaderStack.addSpacer();
  let timeLabel = timeHeaderStack.addText("교시");
  timeLabel.font = Font.boldSystemFont(12);
  timeLabel.textColor = new Color("#8e8e93");
  timeHeaderStack.addSpacer();
  
  timeStack.addSpacer(6);
  
  for (let p = 0; p < 7; p++) {
    let periodTimeStack = timeStack.addStack();
    periodTimeStack.layoutVertically();
    periodTimeStack.centerAlignContent();
    periodTimeStack.setPadding(3, 2, 3, 2);
    
    let h1 = periodTimeStack.addStack(); h1.layoutHorizontally(); h1.addSpacer();
    let txt1 = h1.addText(`${p + 1}`);
    h1.addSpacer();
    
    let h2 = periodTimeStack.addStack(); h2.layoutHorizontally(); h2.addSpacer();
    let txt2 = h2.addText(`(${START_TIMES[p]})`);
    h2.addSpacer();
    
    txt1.font = Font.boldSystemFont(11);
    txt1.textColor = new Color("#8e8e93");
    txt2.font = Font.systemFont(7.5); // 시간은 컴팩트하게
    txt2.textColor = new Color("#636366");
    
    timeStack.addSpacer(4);
    timeStack.addSpacer(4); // 다른 요일 셀의 마진 합과 동일하게 보정
  }
  gridStack.addSpacer(6); // 시간 축 기둥과 월요일 사이 여백 분리

  // ────────────────────────────────────────────────────────
  // 3. 월~금 시간표 빌드
  // ────────────────────────────────────────────────────────
  for (let d = 0; d < 5; d++) {
    let dayStack = gridStack.addStack(); 
    dayStack.layoutVertically();
    
    let dayHeaderStack = dayStack.addStack();
    dayHeaderStack.layoutHorizontally();
    dayHeaderStack.addSpacer();
    let dayLabel = dayHeaderStack.addText(days[d]);
    dayLabel.font = Font.boldSystemFont(12); 
    dayLabel.textColor = new Color("#8e8e93"); 
    dayHeaderStack.addSpacer();
    
    dayStack.addSpacer(6);

    let dayData = (schedule && !errorMsg) ? (schedule[d] || schedule[String(d)]) : null;

    for (let p = 0; p < 7; p++) {
      let cellData = (dayData && dayData[p]) ? dayData[p] : null;
      let cellText = (cellData && cellData.subject) ? cellData.subject : "-";
      let isChanged = cellData ? cellData.isChanged : false; 
      let isCancelled = cellText.includes("(휴강)");

      let cleanText = cellText.replace("(휴강)", "").trim();
      let classTextStr = "-";
      let subjTextStr = "";
      let classKey = "";

      if (cleanText !== "-") {
        let parts = cleanText.split(" ");
        classTextStr = parts[0]; 
        subjTextStr = parts.slice(1).join(" ").replace(" ", "/").replace(",", "/"); 
        let match = classTextStr.match(/(\d+-\d+)/);
        if (match) classKey = match[1]; 
      }

      let periodStack = dayStack.addStack(); 
      periodStack.layoutVertically(); 
      periodStack.centerAlignContent();
      periodStack.setPadding(3, 2, 3, 2); 
      periodStack.cornerRadius = 6; 

      if (isCancelled) {
        periodStack.backgroundColor = new Color("#424242"); 
      } else if (isChanged) {
        periodStack.backgroundColor = Color.dynamic(new Color("#60FFAB40"), new Color("#40FFAB40")); 
      }

      let h1 = periodStack.addStack(); h1.layoutHorizontally(); h1.addSpacer();
      let txt1 = h1.addText(classTextStr);
      h1.addSpacer();
      
      let h2 = periodStack.addStack(); h2.layoutHorizontally(); h2.addSpacer();
      let txt2 = h2.addText(subjTextStr ? subjTextStr : " ");
      h2.addSpacer();

      txt1.font = Font.boldSystemFont(11); 
      txt1.lineLimit = 1;
      if (subjTextStr.length > 3 || subjTextStr.includes("/")) {
          txt2.font = Font.systemFont(8);
      } else {
          txt2.font = Font.systemFont(9); 
      }
      txt2.lineLimit = 1;

      if (classKey) {
        if (isCancelled) {
          txt1.textColor = new Color("#FFFFFF", 0.4);
          txt2.textColor = new Color("#FFFFFF", 0.4);
        } else {
          txt1.textColor = new Color(classColorMap[classKey] || CLASS_COLORS[0]);
          txt2.textColor = new Color(subjectColorMap[subjTextStr] || "#FFFFFF"); 
        }
      } else {
        txt1.font = Font.systemFont(11); 
        txt1.textColor = new Color("#444446"); 
      }
      
      dayStack.addSpacer(4);
    }
    if (d < 4) gridStack.addSpacer(6); 
  }

  if (errorMsg) {
    widget.addSpacer(4);
    let errText = widget.addText(`💡 ${errorMsg}`);
    errText.font = Font.systemFont(10);
    errText.textColor = new Color("#ffcc00");
    errText.centerAlignText();
  }
}

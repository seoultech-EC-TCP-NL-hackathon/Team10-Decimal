// 전역 변수
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordingTimer = null;
let startTime = 0;
let totalRecordingTime = 0; // 누적 녹음 시간
let currentAudioFile = null;
let selectedFiles = [];
let sessionHistory = [];
let projects = {};
let openTabs = new Map(); // 열려있는 탭들
let activeTabId = 'welcome';
let tabCounter = 1;
let isModalMinimized = false; // 모달 최소화 상태

// VS Code 스타일 파일 시스템 시뮬레이션
let fileSystem = {
    '/': {
        type: 'folder',
        name: '강의 요약 프로젝트',
        children: {
            'recordings': {
                type: 'folder',
                name: '녹음 파일',
                children: {}
            },
            'summaries': {
                type: 'folder',
                name: '요약 파일',
                children: {}
            }
        }
    }
};

const LOOSE_DIR   = 'summaries';          // 미지정 요약이 저장되는 루트 폴더
const SUMMARY_MARKDOWN = 'summary.md';
const SUMMARY_METADATA = 'metadata.json';
let selectedProjectsDirHandle = null;     // 사용자가 고른 projects 루트 (apps/projects)
const AUDIO_DEFAULT_EXT = '.webm';

// --- 디렉터리 핸들 영구 저장용 IndexedDB 헬퍼 ---
const IDB_DB = 'lectureAI';
const IDB_STORE = 'handles';
function idbOpen(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = ()=> req.result.createObjectStore(IDB_STORE);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
async function idbSet(key, val){
  const db = await idbOpen();
  const tx = db.transaction(IDB_STORE, 'readwrite');
  tx.objectStore(IDB_STORE).put(val, key);
  return new Promise((res, rej)=>{ tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); });
}
async function idbGet(key){
  const db = await idbOpen();
  const tx = db.transaction(IDB_STORE, 'readonly');
  const req = tx.objectStore(IDB_STORE).get(key);
  return new Promise((res, rej)=>{ req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); });
}
async function idbDel(key){
  const db = await idbOpen();
  const tx = db.transaction(IDB_STORE, 'readwrite');
  tx.objectStore(IDB_STORE).delete(key);
  return new Promise((res, rej)=>{ tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); });
}

// 권한 확인/요청
async function verifyDirPermission(handle, write=true){
  const mode = write ? 'readwrite' : 'read';
  // 이미 부여되어 있으면 OK
  if ((await handle.queryPermission({mode})) === 'granted') return true;
  // 요청
  return (await handle.requestPermission({mode})) === 'granted';
}

function updateLocalRootLabel() {
    const el = document.getElementById('localRootLabel');
    if (!el) return;
    el.textContent = selectedProjectsDirHandle ? selectedProjectsDirHandle.name : '미선택';
}

// 페이지 로드 시 자동 복원
async function restoreLocalProjectsFolder(){
    try{
        const handle = await idbGet('projectsRoot');
        if (!handle) return;
        // 권한 확인/요청
        const ok = await verifyDirPermission(handle, true);
        if (!ok) { await idbDel('projectsRoot'); return; }
        selectedProjectsDirHandle = handle;
        updateLocalRootLabel();
        await renderLocalFilesPanel();
    }catch(e){ console.warn('로컬 루트 복원 실패:', e); }
}

// DOM이 로드되면 실행
document.addEventListener('DOMContentLoaded', function() {
    console.log('강의 요약 AI가 로드되었습니다.');

    initializeApp();
    loadSessionHistory();
    loadProjects();
    initializeTabs();
    setupSidebarTabs();

    switchSidebarPanel('summaries');
    renderProjects();
    restoreLocalProjectsFolder(); // ← 자동 복원 시도
});

// 앱 초기화
function initializeApp() {
    checkMicrophonePermission();
    setupEventListeners();
    updateSummariesList();
    
    console.log('앱이 초기화되었습니다.');
}

// 탭 시스템 초기화
function initializeTabs() {
    openTabs.set('welcome', {
        id: 'welcome',
        title: '시작하기',
        type: 'welcome',
        icon: 'fas fa-home',
        closable: false
    });
    
    updateTabBar();
}

// 사이드바 탭 설정
function setupSidebarTabs() {
    const sidebarTabs = document.querySelectorAll('.sidebar-tab');
    
    sidebarTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const panelId = this.dataset.panel;
            switchSidebarPanel(panelId);
        });
    });
}

// 사이드바 토글 버튼
function toggleSidebarMini() {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.querySelector('.sidebar-toggle-btn');
    const icon = btn.querySelector('i');

    sidebar.classList.toggle('mini');

    // 아이콘 방향 전환
    if (sidebar.classList.contains('mini')) {
        icon.classList.remove('fa-chevron-left');
        icon.classList.add('fa-chevron-right');
    } else {
        icon.classList.remove('fa-chevron-right');
        icon.classList.add('fa-chevron-left');
    }
}

// 사이드바 패널 전환
function switchSidebarPanel(panelId) {
    // 탭 활성화 상태 변경
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-panel="${panelId}"]`).classList.add('active');
    
    // 패널 표시 변경
    document.querySelectorAll('.sidebar-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.getElementById(`${panelId}-panel`).classList.add('active');
}

// 마이크 권한 확인
async function checkMicrophonePermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        console.log('마이크 권한이 허용되었습니다.');
    } catch (error) {
        console.error('마이크 권한이 거부되었습니다:', error);
        showNotification('error', '마이크 권한이 필요합니다. 브라우저 설정에서 마이크 권한을 허용해주세요.');
    }
}

function setupEventListeners() {
    // 키보드 단축키
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey || e.metaKey) {
            switch(e.key) {
                case 'n':
                    e.preventDefault();
                    showNewFileMenu();
                    break;
                case 'w':
                    e.preventDefault();
                    closeActiveTab();
                    break;
                case 't':
                    e.preventDefault();
                    startRecording();
                    break;
            }
        }
        
        // ESC 키로 모달 닫기
        if (e.key === 'Escape') {
            closeRecordingModal();
        }
    });

    // 클릭 이벤트로 메뉴 닫기
    document.addEventListener('click', function(e) {
        const newFileMenu = document.getElementById('newFileMenu');
        const newFileBtn = document.querySelector('.new-file-btn');
    });
}


// 실시간 녹음 시작
function startRecording() {
    showRecordingModal('recording');
}

function resetRecordingUI() {
  const statusText = document.querySelector('#recordingStatus .status-text');
  const timer = document.getElementById('recordingTimer');
  if (statusText) statusText.textContent = '준비됨';
  if (timer) {
    timer.classList.remove('active');
    timer.textContent = '00:00';
  }
}

// 파일 업로드 시작
function uploadFile() {
    showRecordingModal('upload');
}

// 녹음 모달 표시
function showRecordingModal(type) {
    const modal = document.getElementById('recordingModal');
    const title = document.getElementById('modalTitle');
    const recordingControls = document.getElementById('recordingControls');
    const uploadControls = document.getElementById('uploadControls');
    
    // 초기화
    totalRecordingTime = 0;
    recordedChunks = [];
    isRecording = false;
    currentAudioFile = null;
    startTime = 0;
    
    if (type === 'recording') {
        title.textContent = '실시간 녹음';
        recordingControls.style.display = 'block';
        uploadControls.style.display = 'none';
        
        // 버튼을 초기 상태로 리셋
        resetToRecordingButton();
    } else {
        title.textContent = '파일 업로드';
        recordingControls.style.display = 'none';
        uploadControls.style.display = 'block';

        selectedFiles = [];
        const prev = document.getElementById('uploadPreview');
        if(prev) prev.innerHTML = '';
    }
    
    modal.classList.add('show');
    isModalMinimized = false;
    hideRecordingMinibar();
    disableSummarizeButton();
}

// 녹음 모달 닫기
function closeRecordingModal(keepState = false) {
  const modal = document.getElementById('recordingModal');
  modal.classList.remove('show');

  // 녹음 중이면 중지
  if (isRecording) {
    toggleRecording();
  }

  // 미니바 숨김
  hideRecordingMinibar();
  isModalMinimized = false;

  // 상태 초기화 (요약 버튼에서 닫을 때는 keepState=true로 상태 유지)
  if (!keepState) {
    currentAudioFile = null;
    totalRecordingTime = 0;
    recordedChunks = [];
    disableSummarizeButton();
    const fileInput = document.getElementById('audioFile');
    if (fileInput) fileInput.value = '';
  }
}

// 실시간 녹음 토글
async function toggleRecording() {
    const recordBtn = document.getElementById('recordBtn');
    const recordingStatus = document.getElementById('recordingStatus');
    const statusText = recordingStatus.querySelector('.status-text');
    const timer = document.getElementById('recordingTimer');
    
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 44100,
                    channelCount: 1,
                    volume: 1.0
                }
            });
            
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            recordedChunks = [];
            
            mediaRecorder.ondataavailable = function(event) {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = function() {
                const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
                currentAudioFile = audioBlob;
                
                // 누적 시간 업데이트
                if (startTime) {
                    totalRecordingTime += Date.now() - startTime;
                }
                
                // 녹음 완료 후 버튼 UI 변경
                updateRecordingButtons();
                enableSummarizeButton();
                
                showNotification('success', '녹음이 완료되었습니다!');
            };
            
            mediaRecorder.start();
            isRecording = true;
            startTime = Date.now();
            
            // UI 업데이트
            recordBtn.classList.add('recording');
            recordBtn.innerHTML = '<i class="fas fa-stop"></i><span>녹음 중지</span>';
            statusText.textContent = '녹음 중...';
            timer.classList.add('active');
            
            // 타이머 시작
            recordingTimer = setInterval(updateTimer, 1000);
            updateMinibarUI();
            
        } catch (error) {
            console.error('녹음 시작 실패:', error);
            showNotification('error', '녹음을 시작할 수 없습니다. 마이크 권한을 확인해주세요.');
        }
    } else {
        // 녹음 중지
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        
        isRecording = false;
        clearInterval(recordingTimer);
        updateMinibarUI();
    }
}

// 녹음 타이머 업데이트
function updateTimer() {
    const elapsedMs = isRecording && startTime
        ? totalRecordingTime + (Date.now() - startTime)
        : totalRecordingTime;
    
    const elapsed = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    
    const timer = document.getElementById('recordingTimer');
    const minibarTimer = document.getElementById('minibarTimer');
    
    const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    if (timer) timer.textContent = timeString;
    if (minibarTimer) minibarTimer.textContent = timeString;
}

// 녹음 중지 후 버튼 UI 업데이트 (이어서 녹음 / 처음부터)
function updateRecordingButtons() {
    const recordingSection = document.querySelector('.recording-section');
    
    const timeString = formatTime(totalRecordingTime);
    
    recordingSection.innerHTML = `
        <div class="recording-controls-completed">
            <div class="button-group">
                <button class="control-btn continue-btn" onclick="continueRecording()">
                    <i class="fas fa-play"></i>
                    <span>이어서 녹음</span>
                </button>
                <button class="control-btn restart-btn" onclick="restartRecording()">
                    <i class="fas fa-redo"></i>
                    <span>처음부터</span>
                </button>
            </div>
            <div class="recording-info">
                <div class="info-item">
                    <span class="info-label">상태:</span>
                    <span class="info-value completed">녹음 완료</span>
                </div>
                <div class="info-item">
                    <span class="info-label">총 시간:</span>
                    <span class="info-value time">${timeString}</span>
                </div>
            </div>
        </div>
    `;
}

// 시간 포맷 함수
function formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// 이어서 녹음
async function continueRecording() {
    // 버튼을 원래 녹음 버튼으로 되돌리기
    resetToRecordingButton();
    
    // 녹음 시작
    try {
        await toggleRecording();
    } catch (error) {
        console.error('이어서 녹음 실패:', error);
        showNotification('error', '녹음을 시작할 수 없습니다.');
    }
}

// 처음부터 녹음
async function restartRecording() {
    if (confirm('기존 녹음을 삭제하고 처음부터 시작하시겠습니까?')) {
        // 모든 녹음 데이터 초기화
        recordedChunks = [];
        totalRecordingTime = 0;
        currentAudioFile = null;
        startTime = 0;
        
        // 버튼 초기화
        resetToRecordingButton();
        
        // 요약 버튼 비활성화
        disableSummarizeButton();
        
        // 녹음 시작
        try {
            await toggleRecording();
        } catch (error) {
            console.error('처음부터 녹음 실패:', error);
            showNotification('error', '녹음을 시작할 수 없습니다.');
        }
    }
}

// 원래 녹음 버튼으로 되돌리기
function resetToRecordingButton() {
    const recordingSection = document.querySelector('.recording-section');
    
    recordingSection.innerHTML = `
        <div class="recording-controls-initial">
            <button class="record-btn primary" id="recordBtn" onclick="toggleRecording()">
                <i class="fas fa-microphone"></i>
                <span>녹음 시작</span>
            </button>
            <div class="recording-status" id="recordingStatus">
                <div class="status-row">
                    <span class="status-text">준비됨</span>
                    <div class="recording-timer" id="recordingTimer">00:00</div>
                </div>
            </div>
        </div>
    `;
}

// 모달 최소화
function minimizeRecordingModal() {
    const modal = document.getElementById('recordingModal');
    if (!modal) return;
    
    modal.classList.remove('show');
    isModalMinimized = true;
    showRecordingMinibar();
    updateMinibarUI();
}

// 모달 복원
function restoreRecordingModal() {
    const modal = document.getElementById('recordingModal');
    const minibar = document.getElementById('recordingMinibar');
    
    if (modal) modal.classList.add('show');
    if (minibar) minibar.style.display = 'none';
    isModalMinimized = false;
}

// 미니바 표시
function showRecordingMinibar() {
    const minibar = document.getElementById('recordingMinibar');
    if (!minibar) return;
    minibar.style.display = 'flex';
    updateMinibarUI();
}

// 미니바 숨김
function hideRecordingMinibar() {
    const minibar = document.getElementById('recordingMinibar');
    if (!minibar) return;
    minibar.style.display = 'none';
}

// 미니바 UI 업데이트
function updateMinibarUI() {
    const minibar = document.getElementById('recordingMinibar');
    if (!minibar || minibar.style.display === 'none') return;

    const statusEl = document.getElementById('minibarStatus');
    if (statusEl) {
        if (isRecording) {
            statusEl.textContent = '녹음 중';
            minibar.classList.add('active');
        } else if (currentAudioFile) {
            statusEl.textContent = '녹음 완료';
            minibar.classList.remove('active');
        } else {
            statusEl.textContent = '대기';
            minibar.classList.remove('active');
        }
    }
    
    updateTimer();
}

// 파일 업로드 처리
function handleFileUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const valid = [];
    for (const f of files) {
        if (!f.type.startsWith('audio/')) {
            showNotification('error', `오디오만 업로드 가능합니다: ${f.name}`);
            continue;
        }
        if (f.size > 100 * 1024 * 1024) {
            showNotification('error', `100MB 초과: ${f.name}`);
            continue;
        }
        valid.push(f);
    }

    // 새로 선택한 파일들을 누적 (중복 파일명은 뒤에 (2) 같은 꼬리표 붙이기)
    for (const f of valid) {
        selectedFiles.push(ensureUniqueFileName(f));
    }

    // 단일 파일 로직 호환: 첫 파일을 currentAudioFile로 잡아둠
    currentAudioFile = selectedFiles[0] || null;

    renderUploadPreview();
    updateSummarizeButtonBySelection();
    showNotification('success', `${valid.length}개 파일이 추가되었습니다.`);
}

function updateSummarizeButtonBySelection() {
    if (selectedFiles.length > 0 || currentAudioFile) enableSummarizeButton();
    else disableSummarizeButton();
}

function ensureUniqueFileName(file) {
    const base = file.name;
    let name = base;
    let count = 2;
    const exists = () => selectedFiles.some(sf => sf.name === name);
    while (exists()) {
        const dot = base.lastIndexOf('.');
        if (dot > -1) {
            name = `${base.slice(0, dot)} (${count})${base.slice(dot)}`;
        } else {
            name = `${base} (${count})`;
        }
        count++;
    }
    // File 이름만 바꾸고 내용은 그대로 유지
    return new File([file], name, { type: file.type });
}

function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    const units = ['B','KB','MB','GB'];
    let v = bytes, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function renderUploadPreview() {
    const wrap = document.getElementById('uploadPreview');
    if (!wrap) return;
    wrap.innerHTML = '';

    selectedFiles.forEach((file, idx) => {
        const item = document.createElement('div');
        item.className = 'upload-item';

        // duration 구하려면 오디오 메타를 읽는다 (비동기)
        const url = URL.createObjectURL(file);

        item.innerHTML = `
        <div class="file-icon"><i class="fas fa-file-audio"></i></div>
        <div class="file-meta">
            <div class="file-name" title="${file.name}">${file.name}</div>
            <div class="file-size">${formatBytes(file.size)} <span class="file-duration" id="dur-${idx}"></span></div>
        </div>
        <button class="remove-btn" onclick="removeSelectedFile(${idx})">
            제거
        </button>
        `;
        wrap.appendChild(item);

        // 길이 읽기 (선택 기능)
        const audio = new Audio();
        audio.preload = 'metadata';
        audio.src = url;
        audio.onloadedmetadata = () => {
        const sec = Math.floor(audio.duration || 0);
        const mm = String(Math.floor(sec / 60)).padStart(2, '0');
        const ss = String(sec % 60).padStart(2, '0');
        const slot = document.getElementById(`dur-${idx}`);
        if (slot) slot.textContent = ` • ${mm}:${ss}`;
        URL.revokeObjectURL(url);
        };
    });
}

function removeSelectedFile(index) {
    if (index < 0 || index >= selectedFiles.length) return;
    selectedFiles.splice(index, 1);
    // 단일 호환 변수 갱신
    currentAudioFile = selectedFiles[0] || null;
    renderUploadPreview();
    updateSummarizeButtonBySelection();
}

async function summarizeAudio() {
    // 업로드 모드: selectedFiles가 있으면 그걸로, 아니면 녹음(Blob) 1개
    const hasUploads = selectedFiles.length > 0;
    const files = hasUploads ? selectedFiles : (currentAudioFile ? [currentAudioFile] : []);

    if (files.length === 0) {
        showNotification('error', '먼저 오디오를 녹음하거나 파일을 업로드해주세요.');
        return;
    }

    // 제목 입력
    const today = new Date();
    const defaultTitle = `강의_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const inputTitle = prompt('요약 제목을 입력하세요:', defaultTitle);
    if (inputTitle === null) return; // 취소
    const baseTitle = (inputTitle.trim() || defaultTitle);

    // 모달은 닫되 상태 유지
    closeRecordingModal(true);

    showLoading(true);
    try {
        // 여러 개면 각각 요약 생성
        for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const isMulti = files.length > 1;
        const title = isMulti ? `${baseTitle} - ${f.name}` : baseTitle;
        await simulateSummarizationForFile(title, f);
        }
        showNotification('success', `${files.length}개 요약이 생성되었습니다.`);
        //현재 files 패널이면 요약 패널로 보여주기 (UX 보완, 기존 동작엔 영향 없음)
        const filesPanelActive = document.querySelector('.sidebar-tab.active[data-panel="files"]');
        if (filesPanelActive) switchSidebarPanel('summaries');
    } catch (err) {
        console.error(err);
        showNotification('error', '요약 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
        showLoading(false);
        // 완료 후 업로드 선택 목록 초기화(선택)
        selectedFiles = [];
        const prev = document.getElementById('uploadPreview');
        if (prev) prev.innerHTML = '';
        updateSummarizeButtonBySelection();
    }
}

// 요약 시뮬레이션
async function simulateSummarizationForFile(summaryTitle, fileObjInput) {
    await new Promise(resolve => setTimeout(resolve, 1200)); // 파일당 1.2초 딜레이(시뮬)

    const timestamp = new Date();
    const fileObj = normalizeAudioFile(fileObjInput);
    const fileName = fileObj instanceof File ? fileObj.name : `recording_${timestamp.getTime()}.webm`;

    // 재생용 URL
    const audioUrl = URL.createObjectURL(fileObj);

    const summary = {
        id: Date.now() + Math.floor(Math.random() * 1000), // 겹침 방지
        title: summaryTitle || `${fileName} 요약`,
        fileName,
        content: generateMockSummary(),
        timestamp: timestamp.toLocaleString('ko-KR'),
        type: fileObjInput instanceof File ? 'file' : 'recording',
        audioUrl,
        mimeType: fileObj.type || 'audio/webm',
        fileSize: fileObj.size || 0
    };

    // 즉시 UI/히스토리 반영 (사이드바 "요약본"에 바로 뜸)
    addToHistory(summary);          // 내부에서 updateSummariesList/RecentItems 호출
    createSummaryTab(summary);      // 탭 생성/전환
    updateSummariesList();          // 안전망: 한 번 더 갱신
    updateRecentItems();

    // 디스크/파일트리 반영 (실패해도 UI는 이미 보임)
    try { await persistSummaryToDisk(summary, fileObj); } catch (e) { console.warn('파일 저장 실패:', e); }
    addToFileSystem(summary);
    if (document.getElementById('recordingsFolder') || document.getElementById('summariesFolder')) {
        updateFileTree();
    }
    await renderLocalFilesPanel(); // 로컬 파일 트리도 새 파일 반영
}

// 모의 요약 내용 생성
function generateMockSummary() {
    return `# 강의 요약

## 📝 주요 내용

### 1. 핵심 개념
- **개념 A**: 강의의 첫 번째 주요 개념에 대한 상세한 설명
- **개념 B**: 두 번째 핵심 개념과 실제 적용 방법
- **개념 C**: 세 번째 개념과 이전 개념들과의 연관성

### 2. 실습 내용
1. 기본 설정 및 환경 구성
2. 단계별 실습 진행
3. 결과 확인 및 검증

### 3. 중요 포인트
> 💡 **핵심 메시지**: 이 강의에서 가장 중요한 포인트

- ⚠️ 주의사항: 실습 시 반드시 확인해야 할 사항들
- 📌 팁: 효율적인 학습을 위한 추가 팁들

## 📚 추가 학습 자료

### 참고 문서
- 관련 문서 1
- 관련 문서 2
- 온라인 리소스

### 실습 과제
1. 기본 과제: 강의 내용 복습
2. 심화 과제: 응용 문제 해결
3. 프로젝트: 실제 적용 사례 개발

## 🔗 키워드
\`#강의요약\` \`#학습\` \`#실습\` \`#핵심개념\`

---
*이 요약은 AI에 의해 자동 생성되었습니다.*`;
}

// 요약 탭 생성
function createSummaryTab(summary) {
    const tabId = `summary_${summary.id}`;
    
    // 탭 정보 저장
    openTabs.set(tabId, {
        id: tabId,
        title: summary.title,
        type: 'summary',
        icon: 'fas fa-file-alt',
        closable: true,
        data: summary
    });
    
    // 탭 콘텐츠 생성
    createTabContent(tabId, summary);
    
    // 탭으로 전환
    switchToTab(tabId);
    
    // 탭 바 업데이트
    updateTabBar();
}

// 탭 콘텐츠 생성
function createTabContent(tabId, summary) {
    const tabContents = document.querySelector('.tab-contents');
    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content';
    tabContent.id = `${tabId}-content`;

    // result 섹션 (요약/화자 구분/전체 텍스트 전환 UI)
    tabContent.innerHTML = `
    <div class="summary-viewer">
      <div class="summary-header">
        <div class="summary-meta">
          <h1>${summary.title}</h1>
          <div class="summary-info">
            <span class="summary-type">
              <i class="fas ${summary.type === 'file' ? 'fa-file-audio' : 'fa-microphone'}"></i>
              ${summary.type === 'file' ? '파일 업로드' : '실시간 녹음'}
            </span>
            <span class="summary-date">${summary.timestamp}</span>
          </div>
        </div>
        <div class="summary-actions">
          <button class="action-btn" onclick="exportSummary('${tabId}')" title="내보내기">
            <i class="fas fa-download"></i>
          </button>
          <button class="action-btn" onclick="copySummary('${tabId}')" title="복사">
            <i class="fas fa-copy"></i>
          </button>
        </div>
      </div>

      <section class="result">
        <div class="result-row">
          <button class="btn active" id="show-summary-${tabId}" onclick="showResult('${tabId}','summary')">요약본</button>
          <button class="btn" id="show-raw-${tabId}" onclick="showResult('${tabId}','raw')">화자 구분</button>
          <button class="btn" id="show-plain-${tabId}" onclick="showResult('${tabId}','plain')">오디오 파일</button>
        </div>
        <div id="output-${tabId}" class="resultbox">
          ${markdownToHtml(summary.content)}
        </div>
      </section>
    </div>
    `;

    tabContents.appendChild(tabContent);
}

function showResult(tabId, type) {
    const output = document.getElementById(`output-${tabId}`);
    const tabMeta = openTabs.get(tabId);
    const summary = tabMeta?.data;
    const btns = [
        document.getElementById(`show-summary-${tabId}`),
        document.getElementById(`show-raw-${tabId}`),
        document.getElementById(`show-plain-${tabId}`)
    ];
    btns.forEach(btn => btn.classList.remove('active'));

    switch (type) {
        // 더미 데이터(추후 API 연결 예정)
        case 'summary':
            btns[0].classList.add('active');
            output.innerHTML = `
                <div class="content-body">
                    ${markdownToHtml(generateMockSummary())}
                </div>
                <div class="copy-row">
                    <button class="btn copy-btn" onclick="copyResultText('${tabId}')" title="텍스트 복사">
                        <i class="fas fa-copy"></i><span>&nbsp;텍스트 복사</span>
                    </button>
                </div>
            `;
            break;
        case 'raw':
            btns[1].classList.add('active');
            output.innerHTML = `
                <div class="content-body">
                    <p><strong>[화자1]</strong> HTML은 프로그래밍 언어인가요?<br><strong>[화자2]</strong> 네.</p>
                </div>
                <div class="copy-row">
                    <button class="btn copy-btn" onclick="copyResultText('${tabId}')" title="텍스트 복사">
                        <i class="fas fa-copy"></i><span>&nbsp;텍스트 복사</span>
                    </button>
                </div>
            `;
            break;
        case 'plain':
            btns[2].classList.add('active');
            if (summary?.audioUrl) {
                const niceSize = summary.fileSize ? ` (${(summary.fileSize/1024/1024).toFixed(1)} MB)` : '';
                output.innerHTML = `
                    <div class="audio-player">
                        <audio controls src="${summary.audioUrl}"></audio>
                        <div class="audio-meta">
                            <i class="fas fa-file-audio"></i>
                            <span>${summary.fileName}${niceSize}</span>
                            <a class="audio-download" href="${summary.audioUrl}" download="${summary.fileName}">다운로드</a>
                        </div>
                    </div>
                `;
        } else {
            output.innerHTML = `
                <div class="audio-missing">
                    <i class="fas fa-info-circle"></i>
                    <span>이 세션에 연결된 오디오 파일이 없습니다.<br>새로 요약을 생성하면 재생기가 표시됩니다.</span>
                </div>
            `;
        }
        break;
    }
}

// 간단한 마크다운 to HTML 변환
function markdownToHtml(markdown) {
    return markdown
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/`(.*)`/gim, '<code>$1</code>')
        .replace(/^\- (.*$)/gim, '<li>$1</li>')
        .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
        .replace(/\n/gim, '<br>');
}

// 탭 전환
function switchToTab(tabId) {
    // 모든 탭 콘텐츠 숨기기
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // 선택된 탭 콘텐츠 표시
    const targetContent = document.getElementById(`${tabId}-content`);
    if (targetContent) {
        targetContent.classList.add('active');
    }
    
    activeTabId = tabId;
    updateTabBar();
}

// 탭 바 업데이트
function updateTabBar() {
    const tabBar = document.getElementById('tabBar');
    tabBar.innerHTML = '';
    
    openTabs.forEach((tab, tabId) => {
        const tabElement = document.createElement('div');
        tabElement.className = `tab ${tabId === activeTabId ? 'active' : ''}`;
        tabElement.dataset.tabId = tabId;
        
        tabElement.innerHTML = `
            <span class="tab-title">${tab.title}</span>
            ${tab.closable ? 
                `<i class="fas fa-times tab-close" onclick="closeTab('${tabId}', event)"></i>` :
                `<i class="${tab.icon} tab-icon"></i>`
            }
        `;
        
        tabElement.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                switchToTab(tabId);
            }
        });
        
        tabBar.appendChild(tabElement);
    });
}

// 탭 닫기
function closeTab(tabId, event) {
    if (event) event.stopPropagation();
    
    // 탭 정보 제거
    openTabs.delete(tabId);
    
    // 탭 콘텐츠 제거
    const tabContent = document.getElementById(`${tabId}-content`);
    if (tabContent) {
        tabContent.remove();
    }
    
    // 활성 탭이 닫힌 경우 다른 탭으로 전환
    if (tabId === activeTabId) {
        const remainingTabs = Array.from(openTabs.keys());
        if (remainingTabs.length > 0) {
            switchToTab(remainingTabs[0]);
        }
    }
    
    updateTabBar();
}

// 활성 탭 닫기
function closeActiveTab() {
    const activeTab = openTabs.get(activeTabId);
    if (activeTab && activeTab.closable) {
        closeTab(activeTabId);
    }
}

// 파일 시스템에 추가
function addToFileSystem(summary) {
    const folderPath = summary.type === 'file' ? '/recordings' : '/summaries';
    const folder = fileSystem['/'].children[folderPath.substring(1)];
    
    folder.children[summary.fileName] = {
        type: 'file',
        name: summary.fileName,
        summary: summary,
        extension: summary.type === 'file' ? 'audio' : 'md'
    };
}

// 폴더 DOM이 없으면 스킵
function updateFileTree() {
  const rec = document.getElementById('recordingsFolder');
  const sum = document.getElementById('summariesFolder');
  if (!rec && !sum) return;
  if (rec) updateFolderContents('recordingsFolder', fileSystem['/'].children.recordings.children);
  if (sum) updateFolderContents('summariesFolder', fileSystem['/'].children.summaries.children);
}

function updateFolderContents(folderId, children) {
  const folder = document.getElementById(folderId);
  if (!folder) return; // 안전 가드
  folder.innerHTML = '';
  Object.values(children).forEach(item => {
    const itemElement = document.createElement('div');
    itemElement.className = 'tree-node file';
    const icon = item.extension === 'audio' ? 'fa-file-audio' : 'fa-file-alt';
    itemElement.innerHTML = `
      <div class="tree-node-content" onclick="openFile('${item.name}', '${item.extension}')">
        <i class="fas ${icon}"></i>
        <span>${item.name}</span>
      </div>
    `;
    folder.appendChild(itemElement);
  });
}

// 폴더 토글
function toggleFolder(element) {
    const treeNode = element.closest('.tree-node');
    treeNode.classList.toggle('expanded');
}

// 파일 열기
function openFile(fileName, extension) {
    // 파일에서 요약 찾기
    let summary = null;
    
    Object.values(fileSystem['/'].children).forEach(folder => {
        Object.values(folder.children).forEach(file => {
            if (file.name === fileName && file.summary) {
                summary = file.summary;
            }
        });
    });
    
    if (summary) {
        const tabId = `summary_${summary.id}`;
        
        // 이미 열려있는 탭인지 확인
        if (openTabs.has(tabId)) {
            switchToTab(tabId);
        } else {
            createSummaryTab(summary);
        }
    }
}

// 히스토리에 추가
function addToHistory(summary) {
    sessionHistory.unshift(summary);
    
    if (sessionHistory.length > 20) {
        sessionHistory = sessionHistory.slice(0, 20);
    }
    
    saveSessionHistory();
    updateSummariesList();
    updateRecentItems();
}

// 프로젝트 저장
function saveProjects() {
  try {
    localStorage.setItem('vscode_lectureAI_projects_v2', JSON.stringify(projects));
  } catch (e) { console.error('프로젝트 저장 실패', e); }
}

// 프로젝트 불러오기
function loadProjects() {
  try {
    const saved = localStorage.getItem('vscode_lectureAI_projects_v2');
    projects = saved ? JSON.parse(saved) : {};
  } catch (e) { projects = {}; }
}

// 프로젝트 ID 생성/검사, 할당 여부
function slugify(name){
    // (그대로 유지) 내부 id/키 용. ASCII 위주여도 상관없음.
    return name.toLowerCase().trim().replace(/[^\w\-]+/g,'-').replace(/\-+/g,'-');
}

function sanitizeFSName(name){
    let s = String(name || '').trim();
    // 경로 구분자, 제어문자, Windows 금지 문자 제거/치환
    s = s.replace(/[\/\\:*?"<>|\u0000-\u001F]/g, '-');
    // 공백 정리
    s = s.replace(/\s+/g, ' ');
    // 마지막에 오는 점/공백 제거 (Windows 호환)
    s = s.replace(/[ .]+$/g, '');
    if (!s) s = `summary_${Date.now()}`;
    return s;
}

function isAssigned(summaryId){
  return Object.values(projects).some(p => Array.isArray(p.items) && p.items.includes(summaryId));
}

// 프로젝트 생성
async function createProjectFolder(){
    const name = (prompt('프로젝트 폴더 이름', '새 프로젝트') || '').trim();
    if (!name) return;
    let id = slugify(name) || `p_${Date.now()}`;
    if (projects[id]) { id = `${id}-${Date.now()}`; }
    projects[id] = { name, items: [], expanded: true };
    saveProjects();
    renderProjects();
    // 디스크 폴더 생성
    try { await ensureProjectFolderOnDisk(projects[id].name); } catch (e) { console.warn(e); }
    await renderLocalFilesPanel();
}

// 프로젝트 이름 바꾸기
async function renameProjectFolder(id, e){
    if (e) e.stopPropagation();
    const folder = projects[id]; if (!folder) return;
    const nm = prompt('새 폴더 이름', folder.name);
    if (nm === null) return;
    const name = nm.trim();
    if (!name) return;
    if (name === folder.name) return;
    // 디스크: 폴더명 변경(=복사 후 원본 삭제)
    const oldName = folder.name;
    const summaryIds = Array.isArray(folder.items) ? [...folder.items] : [];
    if (selectedProjectsDirHandle) {
        const existing = await getDirIfExists(selectedProjectsDirHandle, name);
        if (existing) {
            showNotification('error','같은 이름의 폴더가 이미 존재합니다.');
            return;
        }
    }
    try {
        await renameProjectFolderOnDisk(oldName, name);
    } catch (err) {
        console.warn('폴더 이름 변경 실패:', err);
        return;
    }
    folder.name = name;
    await syncProjectSummariesOnDisk(name, summaryIds);
    saveProjects();
    renderProjects();
    await renderLocalFilesPanel();
}

// 프로젝트 삭제
async function deleteProjectFolder(id, e){
    if (e) e.stopPropagation();
    const folder = projects[id];
    if (!folder) return;
    if (!confirm(`"${folder.name}" 폴더의 모든 요약을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;

    const toDelete = Array.isArray(folder.items) ? [...folder.items] : [];
    toDelete.forEach(hardDeleteSummaryById);

    delete projects[id];
    saveProjects();
    renderProjects();
    updateSummariesList();
    updateRecentItems();
    saveSessionHistory();

    try { await deleteProjectFolderOnDisk(folder.name); } catch (err) { console.warn('로컬 폴더 삭제 실패:', err); }

    await renderLocalFilesPanel();
    showNotification('success','폴더와 포함된 요약이 모두 삭제되었습니다.');
}


// 사이드바에서 개별 삭제에 쓰는 로직을 재사용하기 위한 내부 헬퍼
function hardDeleteSummaryById(id){
  const idx = findSummaryIndexById(id);
  if (idx === -1) return;
  const summary = sessionHistory[idx];
  // 1) 히스토리에서 제거
    sessionHistory.splice(idx, 1);
  // 2) 파일시스템에서 제거
  removeFromFileSystem(summary);
  // 3) 열려있는 탭 닫기
  const tabId = `summary_${summary.id}`;
  if (openTabs.has(tabId)) {
    closeTab(tabId);
  }
}


// 드래그 방식으로 프로젝트로 요약본 옮기기
async function addSummaryToProject(folderId, summaryId){
  const folder = projects[folderId]; if (!folder) return;
  if (!folder.items) folder.items = [];
  if (folder.items.includes(summaryId)) return;

  folder.items.push(summaryId);
  Object.entries(projects).forEach(([id, f])=>{
    if (id!==folderId && Array.isArray(f.items)) {
      f.items = f.items.filter(x => x!==summaryId);
    }
  });
  saveProjects();

  const summary = sessionHistory.find(x=>x.id===summaryId);
  if (summary) {
    try { await moveSummaryToProjectOnDisk(folder.name, summary); } catch (e) { console.warn('요약 폴더 이동 실패:', e); }
  }

  renderProjects();
  updateSummariesList();
  await renderLocalFilesPanel();
  showNotification('success','프로젝트로 이동했습니다.');
}


// 프로젝트 트리 렌더
function renderProjects(){
  const wrap = document.getElementById('projectsList');
  if (!wrap) return;
  wrap.innerHTML = '';
  Object.entries(projects).forEach(([id, p])=>{
    const node = document.createElement('div');
    node.className = `tree-node folder ${p.expanded?'expanded':''}`;
    node.innerHTML = `
      <div class="tree-node-content" data-folder-id="${id}">
        <i class="fas fa-folder"></i>
        <span class="folder-name">${p.name}</span>
        <div class="node-actions">
          <button class="icon" title="이름 변경" onclick="renameProjectFolder('${id}', event)"><i class="fas fa-pen"></i></button>
          <button class="icon" title="삭제" onclick="deleteProjectFolder('${id}', event)"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      <div class="tree-children"></div>
    `;
    const header = node.querySelector('.tree-node-content');
    header.addEventListener('click', (e)=>{
      // 액션버튼 누른 경우는 토글 막기
      if (e.target.closest('.node-actions')) return;
      p.expanded = !p.expanded; node.classList.toggle('expanded'); saveProjects();
    });
    // 드롭 타깃
    header.addEventListener('dragover', (e)=>{ e.preventDefault(); header.classList.add('drop-target'); });
    header.addEventListener('dragleave', ()=> header.classList.remove('drop-target'));
    header.addEventListener('drop', (e)=>{
      e.preventDefault(); header.classList.remove('drop-target');
      const sid = Number(e.dataTransfer.getData('text/summaryId'));
      if (sid) addSummaryToProject(id, sid);
    });

    // 자식 요약 렌더
    const box = node.querySelector('.tree-children');
    (p.items||[]).forEach(sid=>{
      const s = sessionHistory.find(x=>x.id===sid);
      if (!s) return;
      const item = document.createElement('div');
      item.className = 'tree-node file';
      item.innerHTML = `
        <div class="tree-node-content">
          <i class="fas fa-file-alt"></i>
          <span>${s.title}</span>
        </div>`;
      item.querySelector('.tree-node-content').addEventListener('click', ()=> openSummaryFromHistory(s));
      box.appendChild(item);
    });

    wrap.appendChild(node);
  });
}

// NEW: 미지정(어느 프로젝트에도 속하지 않은) 요약만 추출
function getUnassignedSummaries() {
  return sessionHistory.filter(s => !isAssigned(s.id));
}

// ⬇︎ 프로젝트 '미러' 전용 헬퍼로 분리 (이 코드는 기존 로직 그대로)
function renderProjectsMirrorPanel() {
  const projWrap = document.getElementById('filesProjectsTree');
  if (projWrap) {
    projWrap.innerHTML = '';
    const entries = Object.entries(projects || {});
    if (entries.length === 0) {
      projWrap.innerHTML = `<p style="color:#8c8c8c; padding:4px 8px;">프로젝트 폴더가 없습니다.</p>`;
    } else {
      entries.forEach(([pid, p]) => {
        const node = document.createElement('div');
        node.className = `tree-node folder expanded`;
        node.innerHTML = `
          <div class="tree-node-content">
            <i class="fas fa-folder"></i>
            <span class="folder-name">${p.name}</span>
          </div>
          <div class="tree-children"></div>
        `;
        const box = node.querySelector('.tree-children');
        (p.items || []).forEach(sid => {
          const s = sessionHistory.find(x => x.id === sid);
          if (!s) return;
          const item = document.createElement('div');
          item.className = 'tree-node file';
          item.innerHTML = `
            <div class="tree-node-content" title="${s.title}">
              <i class="fas fa-file-alt"></i>
              <span>${s.title}</span>
            </div>
          `;
          item.querySelector('.tree-node-content')
              .addEventListener('click', () => openSummaryFromHistory(s));
          box.appendChild(item);
        });
        projWrap.appendChild(node);
      });
    }
  }

  // (선택 영역) 미지정 요약 리스트
  const looseWrap = document.getElementById('filesLooseList');
  if (looseWrap) {
    const loose = getUnassignedSummaries();
    looseWrap.innerHTML = '';
    if (!loose.length) {
      looseWrap.innerHTML = `<p style="text-align:center; color:#8c8c8c; padding:12px;">표시할 요약본이 없습니다.</p>`;
    } else {
      loose.forEach(summary => {
        const el = document.createElement('div');
        el.className = 'summary-item';
        el.title = summary.title;
        el.innerHTML = `
          <h4>${summary.title}</h4>
          <p>${summary.timestamp} | ${summary.type === 'file' ? '파일 업로드' : '실시간 녹음'}</p>
         <div class="summary-date"></div>
        `;
        el.addEventListener('click', () => openSummaryFromHistory(summary));
        looseWrap.appendChild(el);
      });
    }
  }
}

// ⬇︎ 실제 로컬 파일(DirectoryPicker)과 연동되는 렌더 래퍼
// 선택된 로컬 루트가 있으면 '실제 디스크 트리'를, 없으면 '프로젝트 미러'를 보여줌
async function renderLocalFilesPanel() {
  const wrap = document.getElementById('filesProjectsTree');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (!selectedProjectsDirHandle) {
    // 아직 로컬 루트가 선택되지 않았다면 기존 프로젝트 미러를 그대로 노출
    renderProjectsMirrorPanel();
    return;
  }

  // 로컬 루트가 선택되어 있으면 실제 디스크 트리 렌더
  try {
    const rootNode = await buildDirectoryTree(selectedProjectsDirHandle);
    renderTreeNode(wrap, rootNode);
  } catch (e) {
    console.warn('로컬 파일 트리 렌더 실패:', e);
    // 실패 시에도 미러로 폴백 (UX 안전망)
    renderProjectsMirrorPanel();
  }
}

// 폴더 선택
async function selectLocalProjectsFolder() {
    try {
        selectedProjectsDirHandle = await window.showDirectoryPicker({ id: 'projects-root' });
        // 권한 고정
        const ok = await verifyDirPermission(selectedProjectsDirHandle, true);
        if (!ok) { showNotification('error','폴더 쓰기 권한이 필요합니다.'); return; }
        // 핸들 저장 → 재접속 불필요
        await idbSet('projectsRoot', selectedProjectsDirHandle);
        showNotification('success', `"${selectedProjectsDirHandle.name}" 폴더 선택됨`);
        updateLocalRootLabel();
        await renderLocalFilesPanel();
    } catch (err) {
        if (err.name !== 'AbortError')
            showNotification('error', '폴더 접근이 취소되었거나 실패했습니다.');
    }
}

// 재귀적으로 폴더 구조 생성
async function buildDirectoryTree(dirHandle) {
    const node = { type: 'folder', name: dirHandle.name, children: [] };
    for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file') node.children.push({ type: 'file', name });
        else if (handle.kind === 'directory') {
            const sub = await buildDirectoryTree(handle);
            node.children.push(sub);
        }
    }
    node.children.sort((a,b)=>a.name.localeCompare(b.name));
    return node;
}

// DOM으로 트리 렌더
function renderTreeNode(parent, node) {
    node.children.forEach(child => {
        const el = document.createElement('div');
        el.className = `tree-node ${child.type}`;
        el.innerHTML = `
           <div class="tree-node-content" onclick="${child.type==='folder'?'toggleFolder(this)':''}">
                <i class="fas ${child.type==='folder'?'fa-folder':'fa-file'}"></i>
                <span>${child.name}</span>
            </div>
            <div class="tree-children"></div>
        `;
        parent.appendChild(el);
        if (child.type==='folder' && child.children?.length){
            const box = el.querySelector('.tree-children');
            renderTreeNode(box, child);
        }
    });
}

// 재귀적으로 파일 트리 렌더
function renderFileTreeNode(parent, node) {
    if (!node || !Array.isArray(node.children)) return;

    node.children.forEach(item => {
        const el = document.createElement('div');
        el.className = `tree-node ${item.type}`;
        el.innerHTML = `
            <div class="tree-node-content" onclick="toggleFolder(this)">
                <i class="fas ${item.type === 'folder' ? 'fa-folder' : 'fa-file'}"></i>
                <span>${item.name}</span>
            </div>
            <div class="tree-children"></div>
        `;
        parent.appendChild(el);

        if (item.type === 'folder' && item.children?.length) {
            const childrenContainer = el.querySelector('.tree-children');
            renderFileTreeNode(childrenContainer, item);
        }
    });
} 

// ==========================
// File System Access Helpers
// ==========================
async function ensureDir(parentHandle, name) {
  return await parentHandle.getDirectoryHandle(name, { create: true });
}

async function getDirIfExists(parentHandle, name) {
  try { return await parentHandle.getDirectoryHandle(name, { create: false }); }
  catch { return null; }
}

async function writeTextFile(dirHandle, filename, text, mimeType = 'text/plain') {
  const fh = await dirHandle.getFileHandle(filename, { create: true });
  const ws = await fh.createWritable();
  const payload = typeof text === 'string' ? text : String(text ?? '');
  await ws.write(new Blob([payload], { type: mimeType }));
  await ws.close();
  return fh;
}

// Blob(오디오 등) 저장
async function writeBlobFile(dirHandle, filename, blob) {
    const fh = await dirHandle.getFileHandle(filename, { create: true });
    const ws = await fh.createWritable();
    await ws.write(blob);
    await ws.close();
    return fh;
}

async function deleteEntry(dirHandle, name, options={}) {
  // options.recursive 지원됨
  try { await dirHandle.removeEntry(name, options); } catch {}
}

async function moveFileBetweenDirs(srcDir, dstDir, filename, newFilename = null) {
  const srcFile = await srcDir.getFileHandle(filename);
  const file = await srcFile.getFile();
  const dstName = newFilename || filename;
  const dst = await dstDir.getFileHandle(dstName, { create: true });
  const ws = await dst.createWritable();
  await ws.write(await file.arrayBuffer());
  await ws.close();
  await deleteEntry(srcDir, filename);
  return dst;
}

async function copyDirRecursive(srcDir, dstParent, newName) {
  const dst = await ensureDir(dstParent, newName);
  for await (const [name, handle] of srcDir.entries()) {
    if (handle.kind === 'file') {
      const f = await handle.getFile();
      const out = await dst.getFileHandle(name, { create: true });
      const ws = await out.createWritable();
      await ws.write(await f.arrayBuffer());
      await ws.close();
    } else {
      const child = await srcDir.getDirectoryHandle(name);
      await copyDirRecursive(child, dst, name);
    }
  }
  return dst;
}

async function deleteDirRecursive(parent, name) {
  await deleteEntry(parent, name, { recursive: true });
}

async function resolveAvailableDirName(parentHandle, baseName) {
  const base = sanitizeFSName(baseName);
  let candidate = base;
  let suffix = 1;
  while (await getDirIfExists(parentHandle, candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

function summaryContentToMarkdown(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function buildSummaryMetadata(summary) {
  return {
    id: summary.id,
    title: summary.title,
    timestamp: summary.timestamp,
    type: summary.type,
    fileName: summary.fileName,
    mimeType: summary.mimeType || null,
    fileSize: summary.fileSize || null,
    parent: summary.__fs?.parent || null,
    folderName: summary.__fs?.name || null,
    audioFile: summary.__fs?.audio || null,
    savedAt: new Date().toISOString()
  };
}

async function writeSummaryArtifacts(folderHandle, summary) {
  if (!folderHandle || !summary) return;
  const markdown = summaryContentToMarkdown(summary.content);
  await writeTextFile(folderHandle, SUMMARY_MARKDOWN, markdown, 'text/markdown');
  const metadata = buildSummaryMetadata(summary);
  await writeTextFile(folderHandle, SUMMARY_METADATA, JSON.stringify(metadata, null, 2), 'application/json');
}

function safeDirNameFromTitle(title) {
    return sanitizeFSName((title || '').trim());
}

function deriveAudioFileName(fileObj, fallbackBase) {
    if (fileObj instanceof File) {
        // 업로드 파일: 원본명에서 금지문자만 치환 (한글 보존)
        return sanitizeFSName(fileObj.name);
    }
    // 녹음 Blob: 제목 기반으로 한글 보존, 확장자 부여
    const base = sanitizeFSName(fallbackBase || `recording_${Date.now()}`);
    return `${base}${AUDIO_DEFAULT_EXT}`;
}

async function ensureLooseDir() {
    if (!selectedProjectsDirHandle) return null;
    return await ensureDir(selectedProjectsDirHandle, LOOSE_DIR);
}

async function persistSummaryToDisk(summary, sourceAudioBlob) {
    if (!selectedProjectsDirHandle) return; // 루트 미선택이면 건너뛰기
    const loose = await ensureLooseDir();
    if (!loose) return;
    const baseName = safeDirNameFromTitle(summary.title);
    const folderName = await resolveAvailableDirName(loose, baseName);
    const folderDir = await ensureDir(loose, folderName);
    const audioName = deriveAudioFileName(sourceAudioBlob, summary.fileName || summary.title);
    const audioBlob = (sourceAudioBlob instanceof Blob) ? sourceAudioBlob : new Blob([], { type: 'audio/webm' });
    await writeBlobFile(folderDir, audioName, audioBlob);
    summary.__fs = {
        parent: LOOSE_DIR,
        name: folderName,
        audio: audioName,
        summaryFile: SUMMARY_MARKDOWN,
        metaFile: SUMMARY_METADATA
    };
    await writeSummaryArtifacts(folderDir, summary);
}






async function renameSummaryOnDisk(summary, newTitle) {
    if (!selectedProjectsDirHandle || !summary?.__fs) return;
    const parent = await ensureDir(selectedProjectsDirHandle, summary.__fs.parent);
    const oldFolder = summary.__fs.name;
    const baseName = safeDirNameFromTitle(newTitle);
    try {
        const src = await getDirIfExists(parent, oldFolder);
        if (!src) return;
        if (baseName === oldFolder) {
            await writeSummaryArtifacts(src, summary);
            return;
        }
        const targetName = await resolveAvailableDirName(parent, baseName);
        const dst = await copyDirRecursive(src, parent, targetName);
        await deleteDirRecursive(parent, oldFolder);
        summary.__fs.name = targetName;
        await writeSummaryArtifacts(dst, summary);
    } catch (e) { console.warn('요약 폴더 이름 변경 실패:', e); }
}


async function deleteSummaryOnDisk(summary) {
    if (!selectedProjectsDirHandle || !summary?.__fs) return;
    const parent = await ensureDir(selectedProjectsDirHandle, summary.__fs.parent);
    try { await deleteDirRecursive(parent, summary.__fs.name); } catch {}
}

async function moveSummaryToProjectOnDisk(projectName, summary) {
    if (!selectedProjectsDirHandle || !summary?.__fs) return;
    const srcParent = await ensureDir(selectedProjectsDirHandle, summary.__fs.parent);
    const dstParent = await ensureDir(selectedProjectsDirHandle, projectName);
    try {
        const src = await getDirIfExists(srcParent, summary.__fs.name);
        if (!src) return;
        const targetName = await resolveAvailableDirName(dstParent, summary.__fs.name);
        const dst = await copyDirRecursive(src, dstParent, targetName);
        await deleteDirRecursive(srcParent, summary.__fs.name);
        summary.__fs.parent = projectName;
        summary.__fs.name = targetName;
        summary.__fs.summaryFile = SUMMARY_MARKDOWN;
        summary.__fs.metaFile = SUMMARY_METADATA;
        await writeSummaryArtifacts(dst, summary);
    } catch (e) { console.warn('요약 폴더 이동 실패:', e); }
}

async function syncProjectSummariesOnDisk(projectName, summaryIds) {
    if (!selectedProjectsDirHandle) return;
    if (!Array.isArray(summaryIds) || summaryIds.length === 0) return;
    const projectDir = await getDirIfExists(selectedProjectsDirHandle, projectName);
    if (!projectDir) return;
    for (const sid of summaryIds) {
        const summary = sessionHistory.find(item => item.id === sid);
        if (!summary?.__fs) continue;
        summary.__fs.parent = projectName;
        summary.__fs.summaryFile = SUMMARY_MARKDOWN;
        summary.__fs.metaFile = SUMMARY_METADATA;
        try {
            const summaryDir = await getDirIfExists(projectDir, summary.__fs.name);
            if (!summaryDir) continue;
            await writeSummaryArtifacts(summaryDir, summary);
        } catch (err) {
            console.warn('프로젝트 요약 동기화 실패:', err);
        }
    }
}



async function ensureProjectFolderOnDisk(projectName) {
  if (!selectedProjectsDirHandle) return;
  await ensureDir(selectedProjectsDirHandle, projectName);
}

async function renameProjectFolderOnDisk(oldName, newName) {
  if (oldName === newName) return;
  if (!selectedProjectsDirHandle) return;
  const parent = selectedProjectsDirHandle;
  const src = await getDirIfExists(parent, oldName);
  if (!src) return;
  await copyDirRecursive(src, parent, newName);
  await deleteDirRecursive(parent, oldName);
}
async function deleteProjectFolderOnDisk(projectName) {
  if (!selectedProjectsDirHandle) return;
  await deleteDirRecursive(selectedProjectsDirHandle, projectName);
}

// 요약 리스트 업데이트
function updateSummariesList() {
  const summariesList = document.getElementById('summariesList');

  if (sessionHistory.length === 0) {
    summariesList.innerHTML = '<p style="text-align: center; color: #8c8c8c; padding: 20px;">아직 요약 기록이 없습니다.</p>';
    return;
  }

  summariesList.innerHTML = '';

  sessionHistory.forEach(summary => {
    // 이미 어떤 프로젝트 폴더에 들어간 요약은 아래 리스트에서 숨김
    if (isAssigned(summary.id)) return;
    const summaryElement = document.createElement('div');
    summaryElement.className = 'summary-item';
    summaryElement.onclick = () => openSummaryFromHistory(summary);
    // 폴더로 이동시키기 위해 드래그 가능
    summaryElement.draggable = true;
    summaryElement.addEventListener('dragstart', (e)=>{
        e.dataTransfer.setData('text/summaryId', String(summary.id));
    });

    summaryElement.innerHTML = `
      <h4 title="${summary.title}">${summary.title}</h4>
      <p>${summary.type === 'file' ? '파일 업로드' : '실시간 녹음'}</p>
      <div class="summary-date">${summary.timestamp}</div>

      <div class="summary-actions">
        <button class="icon-btn" title="이름 바꾸기" onclick="renameSummary(${summary.id}, event)">
          <i class="fas fa-pen"></i>
        </button>
        <button class="icon-btn" title="삭제" onclick="deleteSummary(${summary.id}, event)">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;

    summariesList.appendChild(summaryElement);
  });
}

// 히스토리에서 요약 열기
function openSummaryFromHistory(summary) {
    const tabId = `summary_${summary.id}`;
    
    if (openTabs.has(tabId)) {
        switchToTab(tabId);
    } else {
        createSummaryTab(summary);
    }
}

// 최근 항목 업데이트
function updateRecentItems() {
    const recentItems = document.getElementById('recentItems');
    const recentSummaries = sessionHistory.slice(0, 3);
    
    if (recentSummaries.length === 0) {
        recentItems.innerHTML = '<p style="text-align: center; color: #8c8c8c;">최근 요약이 없습니다.</p>';
        return;
    }
    
    recentItems.innerHTML = '';
    
    recentSummaries.forEach(summary => {
        const itemElement = document.createElement('div');
        itemElement.className = 'recent-item';
        itemElement.onclick = () => openSummaryFromHistory(summary);
        
        itemElement.innerHTML = `
            <h4>${summary.title}</h4>
            <p>${summary.timestamp} | ${summary.type === 'file' ? '파일 업로드' : '실시간 녹음'}</p>
        `;
        
        recentItems.appendChild(itemElement);
    });
}

// 요약 새로고침
function refreshSummaries() {
    updateSummariesList();
    showNotification('success', '요약 목록이 새로고침되었습니다.');
}

// 요약 ID로 배열 인덱스 찾기
function findSummaryIndexById(id) {
  return sessionHistory.findIndex(s => s.id === id);
}

// 탭 제목도 같이 갱신
function updateOpenTabTitle(summaryId, newTitle) {
  const tabId = `summary_${summaryId}`;
  const tab = openTabs.get(tabId);
  if (tab) {
    tab.title = newTitle;
    // 이미 그 탭 DOM이 있다면 즉시 반영
    updateTabBar();
    const headerH1 = document.querySelector(`#${tabId}-content .summary-header .summary-meta h1`);
    if (headerH1) headerH1.textContent = newTitle;
  }
}

// 파일시스템에서 해당 파일 제거(있으면)
function removeFromFileSystem(summary) {
  const folders = fileSystem['/'].children;
  Object.values(folders).forEach(folder => {
    Object.keys(folder.children).forEach(name => {
      const file = folder.children[name];
      if (file && file.summary && file.summary.id === summary.id) {
        delete folder.children[name];
      }
    });
  });
}

// 사이드바에서 개별 삭제
async function deleteSummary(id, e) {
    if (e) e.stopPropagation(); // 버튼 클릭 이벤트 전파 방지

    const idx = findSummaryIndexById(id);
    if (idx === -1) return;

    const summary = sessionHistory[idx];
    if (!confirm(`"${summary.title}" 을(를) 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;

    sessionHistory.splice(idx, 1);
    removeFromFileSystem(summary);

    const tabId = `summary_${summary.id}`;
    if (openTabs.has(tabId)) {
        closeTab(tabId);
    }

    updateSummariesList();
    updateRecentItems();
    saveSessionHistory();

    try { await deleteSummaryOnDisk(summary); } catch (err) { console.warn('로컬 파일 삭제 실패:', err); }

    await renderLocalFilesPanel();
    showNotification('success', '요약이 삭제되었습니다.');
}


// 사이드바에서 이름 바꾸기(제목만)
async function renameSummary(id, e) {
    if (e) e.stopPropagation(); // 버튼 클릭 이벤트 전파 방지

    const idx = findSummaryIndexById(id);
    if (idx === -1) return;

    const current = sessionHistory[idx];
    const proposed = prompt('새 이름을 입력해주세요.', current.title);
    if (proposed === null) return; // 취소
    const newTitle = proposed.trim();
    if (!newTitle) {
        showNotification('error', '이름을 비워둘 수 없습니다.');
        return;
    }

    current.title = newTitle;
    try { await renameSummaryOnDisk(current, newTitle); } catch (err) { console.warn('요약 이름 변경 실패:', err); }

    updateOpenTabTitle(id, newTitle);
    updateSummariesList();
    updateRecentItems();
    saveSessionHistory();

    await renderLocalFilesPanel();
    showNotification('success', '이름이 변경되었습니다.');
}


// 모든 요약 삭제
async function clearAllSummaries() {
    if (!confirm('모든 요약 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
        return;
    }

    sessionHistory = [];

    fileSystem['/'].children.recordings.children = {};
    fileSystem['/'].children.summaries.children = {};

    const summaryTabs = Array.from(openTabs.keys()).filter(id => id.startsWith('summary_'));
    summaryTabs.forEach(tabId => closeTab(tabId));

    if (document.getElementById('recordingsFolder') || document.getElementById('summariesFolder')) {
        updateFileTree();
    }
    updateSummariesList();
    updateRecentItems();
    saveSessionHistory();

    await renderLocalFilesPanel();
    showNotification('success', '모든 요약 기록이 삭제되었습니다.');
}


// 요약본 클립보드 복사
async function copyResultText(tabId) {
    const box = document.getElementById(`output-${tabId}`);
    if (!box) return;

    // 컨텐츠 영역만 선택 (버튼/메타 제외)
    const content = box.querySelector('.content-body');
    const text = (content ? content.innerText : box.innerText);
    try {
        await navigator.clipboard.writeText(text);
        showNotification('success', '텍스트가 클립보드에 복사되었습니다.');
        flashCopyBtn(tabId); // 선택: 버튼에 잠깐 "복사됨" 표시
    } catch (e) {
        // 폴백: 임시 textarea
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showNotification('success', '텍스트가 클립보드에 복사되었습니다.');
            flashCopyBtn(tabId);
        } catch {
            showNotification('error', '복사에 실패했습니다.');
        } finally {
            document.body.removeChild(ta);
        }
    }
}

// 복사 성공 메세지 출력
function flashCopyBtn(tabId) {
    let btn = document.querySelector(`#${tabId}-content .copy-row .btn.copy-btn`);
    if (!btn) btn = document.querySelector(`#${tabId}-content .result .result-row .btn.ghost`);
    if (!btn) return;
    const icon = btn.querySelector('i');
    const span = btn.querySelector('span');
    const old = span.textContent;
    span.textContent = '복사됨';
    icon.classList.remove('fa-copy');
    icon.classList.add('fa-check');
    setTimeout(() => {
        span.textContent = old;
        icon.classList.remove('fa-check');
        icon.classList.add('fa-copy');
    }, 1200);
}

// 버튼 상태 관리
function enableSummarizeButton() {
    const summarizeBtn = document.getElementById('summarizeBtn');
    summarizeBtn.disabled = false;
}

function disableSummarizeButton() {
    const summarizeBtn = document.getElementById('summarizeBtn');
    summarizeBtn.disabled = true;
}

// 알림 표시
function showNotification(type, message) {
    // 간단한 알림 (실제 구현시 토스트 알림으로 개선)
    const alertType = type === 'error' ? '오류' : '알림';
    console.log(`[${alertType}] ${message}`);
    
    // 브라우저 알림으로 임시 구현
    if (type === 'error') {
        alert(`❌ ${message}`);
    } else {
        console.log(`✅ ${message}`);
    }
}

// 로딩 오버레이 제어
function showLoading(show) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (show) {
        loadingOverlay.classList.add('active');
    } else {
        loadingOverlay.classList.remove('active');
    }
}

// 세션 히스토리 저장/불러오기
function saveSessionHistory() {
    try {
        localStorage.setItem('vscode_lectureAI_history', JSON.stringify(sessionHistory));
    } catch (error) {
        console.error('히스토리 저장 실패:', error);
    }
}

function loadSessionHistory() {
    try {
        const saved = localStorage.getItem('vscode_lectureAI_history');
        if (saved) {
            sessionHistory = JSON.parse(saved);
            
            // 파일 시스템 복원
            sessionHistory.forEach(summary => {
                addToFileSystem(summary);
            });
            
            if (document.getElementById('recordingsFolder') || document.getElementById('summariesFolder')) {
                updateFileTree();
            }
            updateSummariesList();
            updateRecentItems();
        }
    } catch (error) {
        console.error('히스토리 불러오기 실패:', error);
        sessionHistory = [];
    }
}

// 정리 작업
window.addEventListener('beforeunload', function() {
    if (isRecording && mediaRecorder) {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
});

// 에러 처리
window.addEventListener('error', function(e) {
    console.error('JavaScript 에러 발생:', e.error);
    showNotification('error', '예상치 못한 오류가 발생했습니다.');
});

console.log('VS Code 스타일 강의 요약 AI 스크립트가 로드되었습니다.');





// ==== 전역 API 설정 ====
const API_CONFIG = {
  baseURL: '/api',
  endpoints: {
    transcribe: '/transcribe'
  },
  // 필요 시 인증 토큰 등 추가
  defaultHeaders: {
    // 'Authorization': 'Bearer <YOUR_TOKEN>'
  },
  timeoutMs: 120_000
};

// 체크박스 상태 읽기
function getKoreanOnlyFlag() {
  const el = document.getElementById('flagKoreanOnly');
  return !!(el && el.checked);
}

// 현재 오디오 파일명/타입 보정
function normalizeAudioFile(file) {
  // File이면 그대로, Blob이면 파일명/타입 보정
  if (file instanceof File) return file;
  const fallbackName = `recording_${Date.now()}.webm`;
  const type = file?.type || 'audio/webm';
  return new File([file], fallbackName, { type });
}

/**
* 오디오 파일과 한국어-only 여부를 백엔드로 전송
@param {Object} opts
@param {Blob|File} [opts.file=currentAudioFile] - 보낼 오디오
@param {boolean} [opts.koreanOnly=UI체크값] - 한국어-only 여부
@returns {Promise<any>} - 백엔드 JSON 응답
*/
async function sendTranscriptionRequest(opts = {}) {
    const fileInput = opts.file || currentAudioFile;
    if (!fileInput) throw new Error('오디오 파일이 없습니다.');

    // 파일/플래그 정리
    const file = normalizeAudioFile(fileInput);
    const koreanOnly = (typeof opts.koreanOnly === 'boolean') ? opts.koreanOnly : getKoreanOnlyFlag();

    // FormData 구성
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('korean_only', String(koreanOnly)); // 'true' | 'false'
    // 확장 여지: fd.append('source', currentAudioFile instanceof File ? 'file' : 'recording');

    // fetch + 타임아웃
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), API_CONFIG.timeoutMs);

    const url = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.transcribe}`;
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            body: fd,
            headers: API_CONFIG.defaultHeaders, // FormData일 때 Content-Type 자동 설정됨
            signal: ctrl.signal,
            credentials: 'include' // 쿠키 기반 세션 쓰면 유지, 아니면 지워도 됨
            });
        } finally {
        clearTimeout(to);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`전송 실패 ${res.status}: ${text || '서버 오류'}`);
    }
    return res.json().catch(() => ({}));
}

// ==== 오픈소스 정보 표시 ====
function showOpenSourceInfo() {
    const tabId = 'opensource';
    
    // 이미 열려있으면 해당 탭으로 전환
    if (openTabs.has(tabId)) {
        switchToTab(tabId);
        return;
    }
    
    // 탭 정보 저장
    openTabs.set(tabId, {
        id: tabId,
        title: '오픈소스 정보',
        type: 'opensource',
        icon: 'fas fa-code',
        closable: true
    });
    
    // 탭 콘텐츠 생성
    createOpenSourceTabContent(tabId);
    
    // 탭으로 전환
    switchToTab(tabId);
    
    // 탭 바 업데이트
    updateTabBar();
}

function createOpenSourceTabContent(tabId) {
    const tabContents = document.querySelector('.tab-contents');
    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content';
    tabContent.id = `${tabId}-content`;
    
    tabContent.innerHTML = `
        <div class="opensource-content">
            <h2>오픈소스 라이선스 정보</h2>
            
            <h3>프론트엔드</h3>
            <table class="opensource-table">
                <thead>
                    <tr>
                        <th>이름</th>
                        <th>분류</th>
                        <th>라이선스</th>
                        <th>링크</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>Font Awesome</strong></td>
                        <td>UI/UX 라이브러리</td>
                        <td>Font Awesome Free (Icons: CC BY 4.0, Code: MIT)</td>
                        <td><a href="https://fontawesome.com/" target="_blank">fontawesome.com</a></td>
                    </tr>
                    <tr>
                        <td>MediaRecorder API</td>
                        <td>오디오/비디오 녹화</td>
                        <td>표준 웹 API (무료)</td>
                        <td><a href="https://w3c.github.io/mediacapture-record/" target="_blank">W3C 스펙</a></td>
                    </tr>
                    <tr>
                        <td>Fetch API</td>
                        <td>네트워크</td>
                        <td>표준 웹 API (무료)</td>
                        <td><a href="https://fetch.spec.whatwg.org/" target="_blank">WHATWG 스펙</a></td>
                    </tr>
                    <tr>
                        <td>localStorage</td>
                        <td>저장소</td>
                        <td>표준 웹 API (무료)</td>
                        <td><a href="https://html.spec.whatwg.org/multipage/webstorage.html" target="_blank">WHATWG 스펙</a></td>
                    </tr>
                </tbody>
            </table>
            
            <h3>백엔드</h3>
            <table class="opensource-table">
                <thead>
                    <tr>
                        <th>이름</th>
                        <th>분류</th>
                        <th>라이선스</th>
                        <th>링크</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>FastAPI</strong></td>
                        <td>라이브러리</td>
                        <td>MIT</td>
                        <td><a href="https://fastapi.tiangolo.com/" target="_blank">fastapi.tiangolo.com</a></td>
                    </tr>
                    <tr>
                        <td><strong>Uvicorn</strong></td>
                        <td>라이브러리</td>
                        <td>BSD 3-Clause</td>
                        <td><a href="https://www.uvicorn.org/" target="_blank">uvicorn.org</a></td>
                    </tr>
                    <tr>
                        <td><strong>SQLAlchemy</strong></td>
                        <td>라이브러리</td>
                        <td>MIT</td>
                        <td><a href="https://www.sqlalchemy.org/" target="_blank">sqlalchemy.org</a></td>
                    </tr>
                    <tr>
                        <td><strong>psycopg2-binary</strong></td>
                        <td>라이브러리</td>
                        <td>LGPL 3.0</td>
                        <td><a href="https://pypi.org/project/psycopg2-binary/" target="_blank">PyPI</a></td>
                    </tr>
                    <tr>
                        <td><strong>Pydantic</strong></td>
                        <td>라이브러리</td>
                        <td>MIT</td>
                        <td><a href="https://docs.pydantic.dev/latest/" target="_blank">pydantic.dev</a></td>
                    </tr>
                    <tr>
                        <td><strong>pydantic-settings</strong></td>
                        <td>라이브러리</td>
                        <td>MIT</td>
                        <td><a href="https://docs.pydantic.dev/latest/concepts/pydantic_settings/" target="_blank">pydantic.dev</a></td>
                    </tr>
                    <tr>
                        <td><strong>python-dotenv</strong></td>
                        <td>라이브러리</td>
                        <td>BSD 3-Clause</td>
                        <td><a href="https://pypi.org/project/python-dotenv/" target="_blank">PyPI</a></td>
                    </tr>
                    <tr>
                        <td><strong>PostgreSQL</strong></td>
                        <td>DB 서버 (소프트웨어)</td>
                        <td>PostgreSQL License</td>
                        <td><a href="https://www.postgresql.org/" target="_blank">postgresql.org</a></td>
                    </tr>
                    <tr>
                        <td><strong>python-multipart</strong></td>
                        <td>라이브러리</td>
                        <td>Apache License 2.0</td>
                        <td><a href="https://pypi.org/project/python-multipart/" target="_blank">PyPI</a></td>
                    </tr>
                </tbody>
            </table>
            
            <h3>AI</h3>
            <table class="opensource-table">
                <thead>
                    <tr>
                        <th>이름</th>
                        <th>분류</th>
                        <th>라이선스</th>
                        <th>링크</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>openai/whisper-large-v3</strong></td>
                        <td>STT 모델</td>
                        <td>Apache License 2.0</td>
                        <td><a href="https://huggingface.co/openai/whisper-large-v3" target="_blank">Hugging Face</a></td>
                    </tr>
                    <tr>
                        <td><strong>openai-whisper</strong></td>
                        <td>파이썬 모듈 (라이브러리)</td>
                        <td>MIT License</td>
                        <td><a href="https://pypi.org/project/openai-whisper/" target="_blank">PyPI</a></td>
                    </tr>
                    <tr>
                        <td><strong>Qwen3-4B-Thinking-2507-GGUF Q8_0</strong></td>
                        <td>LLM 모델 (Refining)</td>
                        <td>Apache License 2.0</td>
                        <td><a href="https://huggingface.co/lmstudio-community/Qwen3-4B-Thinking-2507-GGUF" target="_blank">Hugging Face</a></td>
                    </tr>
                    <tr>
                        <td><strong>Qwen3-4B-Instruct-2507-GGUF Q4_K_M</strong></td>
                        <td>LLM 모델 (Categorizing)</td>
                        <td>Apache License 2.0</td>
                        <td><a href="https://huggingface.co/lmstudio-community/Qwen3-4B-Instruct-2507-GGUF" target="_blank">Hugging Face</a></td>
                    </tr>
                    <tr>
                        <td><strong>pyannote-audio</strong></td>
                        <td>파이썬 모듈 (라이브러리)</td>
                        <td>MIT License</td>
                        <td><a href="https://pypi.org/project/pyannote-audio/" target="_blank">PyPI</a></td>
                    </tr>
                    <tr>
                        <td><strong>pyannote/speaker-diarization-3.1</strong></td>
                        <td>Diarization 모델</td>
                        <td>MIT License</td>
                        <td><a href="https://huggingface.co/pyannote/speaker-diarization-3.1" target="_blank">Hugging Face</a></td>
                    </tr>
                    <tr>
                        <td><strong>llama-cpp-python</strong></td>
                        <td>GGUF 모델 구동용 파이썬 모듈</td>
                        <td>MIT License</td>
                        <td><a href="https://pypi.org/project/llama-cpp-python/" target="_blank">PyPI</a></td>
                    </tr>
                    <tr>
                        <td><strong>DeepSeek-R1-0528-Qwen3-8B-GGUF Q8_0</strong></td>
                        <td>LLM 모델 (Refining)</td>
                        <td>MIT License</td>
                        <td><a href="https://huggingface.co/lmstudio-community/DeepSeek-R1-0528-Qwen3-8B-GGUF" target="_blank">Hugging Face</a></td>
                    </tr>
                </tbody>
            </table>
            
            <div class="opensource-note">
                <strong>참고:</strong> pyannote.audio 라이브러리와 라이브러리 내부적으로 사용되는 diarization 모델은 별개의 라이선스 대상입니다.
            </div>
        </div>
    `;
    
    tabContents.appendChild(tabContent);
}

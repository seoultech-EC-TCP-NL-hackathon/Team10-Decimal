// Version: 2.0.1 - Fixed savedFileNames scope issue
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

// ========================================
// 🚫 페이지 새로고침 완전 차단
// ========================================

// Live Server의 WebSocket 연결 차단 (자동 새로고침 방지)
if (window.WebSocket) {
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        if (url && url.includes('ws://127.0.0.1')) {
            // 더미 WebSocket 반환
            return {
                close: () => {},
                send: () => {},
                addEventListener: () => {}
            };
        }
        return new OriginalWebSocket(url, protocols);
    };
}

// 모든 form submit 이벤트 차단
document.addEventListener('submit', function(e) {
    e.preventDefault();
    return false;
}, true);

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

// DOM이 로드되면 실행
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    loadSessionHistory();
    loadProjects();
    initializeTabs();
    setupSidebarTabs();
    setupSubjectInputListener();
    setupWorkspaceSelectListener();
    switchSidebarPanel('summaries');
    renderProjects();
});

// 앱 초기화
function initializeApp() {
    checkMicrophonePermission();
    setupEventListeners();
    updateSummariesList();
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
    const targetTab = document.querySelector(`[data-panel="${panelId}"]`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
    
    // 패널 표시 변경
    document.querySelectorAll('.sidebar-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    const targetPanel = document.getElementById(`${panelId}-panel`);
    if (targetPanel) {
        targetPanel.classList.add('active');
    }
}

// 현재 활성화된 사이드바 패널 가져오기
function getCurrentSidebarPanel() {
    const activeTab = document.querySelector('.sidebar-tab.active');
    return activeTab ? activeTab.dataset.panel : null;
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
    
    // 폴더 선택 UI 로드
    loadWorkspaceFolders();
    
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
                checkSummarizeButtonState();
                
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
    checkSummarizeButtonState();
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

// 폴더/파일 이름에서 허용되지 않는 문자 제거
function sanitizeFolderName(name) {
    if (!name) return '';
    
    // File System Access API에서 허용하지 않는 문자 제거
    // Windows, macOS, Linux 모두 호환되도록
    const sanitized = name
        .replace(/[\/\\:*?"<>|]/g, '_')  // 특수문자를 언더스코어로 변경
        .replace(/\.+$/g, '')              // 끝의 점 제거
        .trim();
    
    // 빈 문자열이 되면 기본값
    return sanitized || 'untitled';
}

async function summarizeAudio(event) {
    // 페이지 새로고침 방지
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    const hasUploads = selectedFiles.length > 0;
    const files = hasUploads ? selectedFiles : (currentAudioFile ? [currentAudioFile] : []);
    
    if (files.length === 0) {
        showNotification('error', '먼저 오디오를 녹음하거나 파일을 업로드해주세요.');
        return;
    }

    // 모달에서 workspace와 subject 가져오기
    const workspaceSelect = document.getElementById('workspaceSelect');
    const subjectInput = document.getElementById('subjectInput');
    
    let workspaceName = workspaceSelect ? workspaceSelect.value : null;
    let subjectName = subjectInput ? subjectInput.value.trim() : null;
    
    if (!workspaceName || !subjectName) {
        showNotification('error', 'Workspace와 Subject를 모두 입력해주세요.');
        return;
    }
    
    // 폴더 이름에서 허용되지 않는 문자 제거
    workspaceName = sanitizeFolderName(workspaceName);
    subjectName = sanitizeFolderName(subjectName);

    // 로컬 폴더가 없으면 생성 필수
    if (!rootDirHandle) {
        showNotification('error', '먼저 로컬 디렉토리 탭에서 summary 폴더를 열어주세요.\n\n파일을 저장할 폴더가 필요합니다.');
        return;
    }

    let savedFileNames = [];  // 실제 저장된 파일명 기록 (스코프 확장)

    try {
        // workspace 폴더 생성/가져오기
        selectedWorkspaceHandle = await rootDirHandle.getDirectoryHandle(workspaceName, { create: true });
        
        // subject 폴더 생성
        selectedSubjectHandle = await selectedWorkspaceHandle.getDirectoryHandle(subjectName, { create: true });
        selectedSubjectPath = subjectName;
        selectedWorkspacePath = workspaceName;
        
        // 파일들을 subject 폴더에 저장
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileName = file.name || `recording_${Date.now()}.webm`;
            
            try {
                const fileHandle = await selectedSubjectHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(file);
                await writable.close();
                savedFileNames.push(fileName);  // 저장된 파일명 기록
                console.log('💾 파일 저장됨:', fileName);
            } catch (error) {
                console.error(`파일 저장 실패: ${fileName}`, error);
                throw new Error(`파일 저장에 실패했습니다: ${fileName}`);
            }
        }
        
        showNotification('success', `${files.length}개 파일이 summary/${workspaceName}/${subjectName}에 저장되었습니다.`);
        
    } catch (error) {
        console.error('폴더/파일 저장 실패:', error);
        showNotification('error', `폴더 또는 파일 저장에 실패했습니다: ${error.message}`);
        showLoading(false);
        return;
    }

    closeRecordingModal(true);

    showLoading(true);
    try {
        let successCount = 0;
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const actualFileName = savedFileNames[i];  // 실제 저장된 파일명 사용
            console.log(`\n🔄 파일 ${i + 1}/${files.length} 처리 시작:`, actualFileName);
            
            try {
                const summary = await simulateSummarizationForFile(workspaceName, subjectName, f);
                
                console.log('📦 생성된 summary 객체:', summary);
                
                if (summary) {
                    // 실제 저장된 파일명으로 덮어쓰기
                    summary.fileName = actualFileName;
                    console.log('✅ fileName 업데이트:', actualFileName);
                    
                    // JSON과 HTML 파일 모두 저장
                    await saveDataJSON(summary, selectedSubjectHandle);
                    console.log('✅ data.json 저장 완료');
                    
                    await generateAndSaveResultHTML(summary, selectedSubjectHandle);
                    console.log('✅ summary.html 저장 완료');
                    
                    // 디렉토리 트리 전체 새로고침
                    console.log('🔄 디렉토리 트리 새로고침 시작...');
                    await refreshDirectories();
                    console.log('✅ 디렉토리 트리 새로고침 완료');
                    
                    console.log('🎨 createSummaryTab 호출 전');
                    
                    // 기존 페이지의 탭으로 바로 표시
                    createSummaryTab(summary);
                    
                    console.log('✅ createSummaryTab 완료');
                    
                    addToHistory(summary);
                    updateSummariesList();
                    
                    successCount++;
                } else {
                    console.error('❌ summary 객체가 null/undefined입니다');
                }
            } catch (fileError) {
                console.error(`❌ 파일 ${i + 1} 처리 실패:`, fileError);
                console.error('에러 스택:', fileError.stack);
                throw fileError; // 첫 번째 파일 실패시 중단
            }
        }
        
        if (successCount > 0) {
            showNotification('success', `${successCount}개 요약이 생성되었습니다. (Workspace: ${workspaceName}, Subject: ${subjectName})`);
            
            // 디렉토리 트리 새로고침 (새로 생성된 파일 표시)
            if (rootDirHandle) {
                console.log('🔄 디렉토리 새로고침 시작');
                await renderLocalDirectory();
                console.log('✅ 디렉토리 새로고침 완료');
            }
        } else {
            showNotification('error', '요약 생성에 실패했습니다.');
        }
        
        const currentPanel = getCurrentSidebarPanel();
        if (currentPanel !== 'directories') {
            switchSidebarPanel('directories');
        }
        
        // 완료 후 업로드 선택 목록 초기화
        selectedFiles = [];
        const prev = document.getElementById('uploadPreview');
        if (prev) prev.innerHTML = '';
        updateSummarizeButtonBySelection();
        
    } catch (err) {
        console.error('❌❌❌ 요약 생성 최종 오류:', err);
        console.error('에러 타입:', err.name);
        console.error('에러 메시지:', err.message);
        console.error('에러 스택:', err.stack);
        
        const errorMsg = err.message || '알 수 없는 오류가 발생했습니다.';
        showNotification('error', `요약 생성 실패: ${errorMsg}`);
    } finally {
        showLoading(false);
    }
}

// 실제 API로 요약 생성
async function simulateSummarizationForFile(workspace, subject, fileObjInput) {
    console.log('🎬 simulateSummarizationForFile 시작');
    console.log('  workspace:', workspace);
    console.log('  subject:', subject);
    console.log('  fileObjInput:', fileObjInput);
    
    const fileObj = normalizeAudioFile(fileObjInput);
    const fileName = fileObj instanceof File ? fileObj.name : `recording_${Date.now()}.webm`;
    
    console.log('  fileName:', fileName);

    try {
        console.log('📡 API 요청 시작...');
        
        // 실제 백엔드 API 호출 - workspace와 subject 전달
        const response = await sendTranscriptionRequest({ 
            file: fileObj,
            workspace: workspace,
            subject: subject
        });
        
        console.log('✅ API 응답 받음:', response);
        
        if (!response) {
            throw new Error('백엔드 응답이 비어있습니다');
        }
        
        // 백엔드 응답 파싱
        const timestamp = new Date();
        const audioUrl = URL.createObjectURL(fileObj);
        
        // 화자 구분 데이터 파싱 (speaker_attributed_segments)
        let speakerSegments = [];
        if (response.source_materials && response.source_materials.length > 0) {
            const material = response.source_materials[0];
            if (material.speaker_attributed_segments) {
                speakerSegments = material.speaker_attributed_segments.map(seg => ({
                    speaker: seg.speaker_label || 'Unknown',
                    start: seg.start_time_seconds,
                    end: seg.end_time_seconds,
                    text: seg.text
                }));
                console.log(`📝 화자 구분 세그먼트 ${speakerSegments.length}개 파싱 완료`);
            }
        }
        
        const summary = {
            id: response.id || Date.now(),
            title: response.title || `${workspace} - ${subject}`,
            workspace: workspace,
            subject: subject,
            fileName,
            
            // 요약본 (마크다운)
            content: response.final_summary || generateMockSummary(),
            
            // 화자 구분 데이터
            speakerSegments: speakerSegments,
            
            // 메타 정보
            timestamp: timestamp.toLocaleString('ko-KR'),
            type: fileObjInput instanceof File ? 'file' : 'recording',
            audioUrl,
            mimeType: fileObj.type || 'audio/webm',
            fileSize: fileObj.size || 0,
            jobStatus: response.status || 'PENDING',
            rawResponse: response
        };
        
        console.log('📦 summary 객체 생성 완료:', summary);
        
        return summary;
        
    } catch (error) {
        console.error('❌ simulateSummarizationForFile 에러:', error);
        console.error('에러 스택:', error.stack);
        throw error;
    }
}

// ========================================
// HTML 자동 생성 및 저장 함수
// ========================================

// summary 데이터를 받아서 완전한 HTML 파일 생성
async function generateAndSaveResultHTML(summary, subjectHandle) {
    console.log('🎨🎨🎨 generateAndSaveResultHTML 함수 시작!');
    console.log('� summary 데이터:', summary);
    console.log('📁 subjectHandle:', subjectHandle);
    
    if (!summary) {
        console.error('❌ summary가 없습니다!');
        return false;
    }
    
    if (!subjectHandle) {
        console.error('❌ subjectHandle이 없습니다!');
        return false;
    }
    
    console.log('�📝 summary.html 생성 시작...');
    
    // marked 라이브러리로 마크다운 → HTML 변환
    let summaryHTML = '';
    try {
        if (typeof marked === 'undefined') {
            console.error('❌ marked 라이브러리가 로드되지 않았습니다!');
            summaryHTML = `<pre>${summary.content || '요약 내용 없음'}</pre>`;
        } else {
            summaryHTML = marked.parse(summary.content || '요약 내용 없음');
        }
    } catch (error) {
        console.error('❌ 마크다운 파싱 오류:', error);
        summaryHTML = `<pre>${summary.content || '요약 내용 없음'}</pre>`;
    }
    
    // 화자 구분 HTML 생성
    const speakerHTML = summary.speakerSegments && summary.speakerSegments.length > 0
        ? summary.speakerSegments.map(seg => `
            <div class="speaker-entry">
                <div class="speaker-header">
                    <span class="speaker-name">${seg.speaker || 'Unknown'}</span>
                    <span class="timestamp">${formatTimeFromSeconds(seg.start)} - ${formatTimeFromSeconds(seg.end)}</span>
                </div>
                <div class="speaker-text">${seg.text || ''}</div>
            </div>
        `).join('')
        : '<p style="color: #999;">화자 구분 데이터가 없습니다.</p>';
    
    // 완전한 HTML 문서 생성
    const htmlContent = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${summary.title || '요약 결과'}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #1e1e1e;
            color: #cccccc;
            line-height: 1.6;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        header {
            background: #252526;
            padding: 20px;
            border-bottom: 1px solid #3e3e42;
            margin-bottom: 20px;
        }
        
        h1 {
            color: #ffffff;
            font-size: 24px;
            margin-bottom: 10px;
        }
        
        .meta-info {
            color: #858585;
            font-size: 14px;
        }
        
        .tabs {
            display: flex;
            background: #252526;
            border-bottom: 1px solid #3e3e42;
            margin-bottom: 20px;
        }
        
        .tab {
            padding: 12px 24px;
            cursor: pointer;
            background: transparent;
            border: none;
            color: #cccccc;
            font-size: 14px;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }
        
        .tab:hover {
            background: #2a2d2e;
            color: #ffffff;
        }
        
        .tab.active {
            color: #4fc3f7;
            border-bottom-color: #4fc3f7;
        }
        
        .tab-content {
            display: none;
            background: #252526;
            padding: 30px;
            border-radius: 4px;
            min-height: 400px;
        }
        
        .tab-content.active {
            display: block;
        }
        
        /* 요약본 스타일 */
        .tab-content h1, .tab-content h2, .tab-content h3 {
            color: #ffffff;
            margin: 20px 0 10px 0;
        }
        
        .tab-content h2 {
            font-size: 20px;
            border-bottom: 1px solid #3e3e42;
            padding-bottom: 8px;
        }
        
        .tab-content h3 {
            font-size: 18px;
        }
        
        .tab-content p {
            margin: 10px 0;
            line-height: 1.8;
        }
        
        .tab-content ul, .tab-content ol {
            margin: 10px 0 10px 20px;
        }
        
        .tab-content li {
            margin: 5px 0;
        }
        
        .tab-content code {
            background: #1e1e1e;
            padding: 2px 6px;
            border-radius: 3px;
            color: #ce9178;
            font-family: 'Courier New', monospace;
        }
        
        .tab-content pre {
            background: #1e1e1e;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 15px 0;
        }
        
        .tab-content blockquote {
            border-left: 3px solid #4fc3f7;
            padding-left: 15px;
            margin: 15px 0;
            color: #a0a0a0;
        }
        
        /* 화자 구분 스타일 */
        .speaker-entry {
            margin: 20px 0;
            padding: 15px;
            background: #1e1e1e;
            border-radius: 4px;
            border-left: 3px solid #4fc3f7;
        }
        
        .speaker-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .speaker-name {
            font-weight: 600;
            color: #4fc3f7;
            font-size: 14px;
        }
        
        .timestamp {
            color: #858585;
            font-size: 12px;
            font-family: 'Courier New', monospace;
        }
        
        .speaker-text {
            color: #cccccc;
            line-height: 1.8;
        }
        
        /* 오디오 플레이어 스타일 */
        audio {
            width: 100%;
            margin: 20px 0;
            outline: none;
        }
        
        .audio-info {
            color: #858585;
            font-size: 14px;
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>${summary.title || '요약 결과'}</h1>
            <div class="meta-info">
                생성일: ${summary.timestamp || new Date().toLocaleString('ko-KR')} | 
                파일: ${summary.fileName || 'Unknown'}
            </div>
        </header>
        
        <div class="tabs">
            <button class="tab active" onclick="switchTab(0)">📄 요약본</button>
            <button class="tab" onclick="switchTab(1)">👥 화자 구분</button>
            <button class="tab" onclick="switchTab(2)">🎵 오디오</button>
        </div>
        
        <div class="tab-content active" id="tab-0">
            ${summaryHTML}
        </div>
        
        <div class="tab-content" id="tab-1">
            ${speakerHTML}
        </div>
        
        <div class="tab-content" id="tab-2">
            <audio controls src="./${summary.fileName}">
                Your browser does not support the audio element.
            </audio>
            <div class="audio-info">
                파일명: ${summary.fileName || 'Unknown'}<br>
                크기: ${summary.fileSize ? (summary.fileSize / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown'}
            </div>
        </div>
    </div>
    
    <script>
        function switchTab(index) {
            // 모든 탭과 컨텐츠 비활성화
            const tabs = document.querySelectorAll('.tab');
            const contents = document.querySelectorAll('.tab-content');
            
            tabs.forEach(tab => tab.classList.remove('active'));
            contents.forEach(content => content.classList.remove('active'));
            
            // 선택된 탭과 컨텐츠 활성화
            tabs[index].classList.add('active');
            document.getElementById('tab-' + index).classList.add('active');
        }
    </script>
</body>
</html>`;

    // HTML 파일로 저장 (파일명: workspace-subject.html)
    try {
        const htmlFileName = `${summary.workspace}-${summary.subject}.html`;
        const fileHandle = await subjectHandle.getFileHandle(htmlFileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(htmlContent);
        await writable.close();
        
        console.log(`✅ ${htmlFileName} 저장 완료`);
        return true;
    } catch (error) {
        console.error('❌ HTML 파일 저장 실패:', error);
        showNotification('error', 'HTML 파일 저장에 실패했습니다.');
        return false;
    }
}

// JSON 백업 파일 저장
async function saveDataJSON(summary, subjectHandle) {
    console.log('📝 data.json 생성 시작...');
    
    const jsonData = {
        title: summary.title,
        workspace: summary.workspace,
        subject: summary.subject,
        fileName: summary.fileName,
        timestamp: summary.timestamp,
        summary: summary.content,
        speakerSegments: summary.speakerSegments,
        fileSize: summary.fileSize,
        mimeType: summary.mimeType,
        jobStatus: summary.jobStatus
    };
    
    try {
        const fileHandle = await subjectHandle.getFileHandle('data.json', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(jsonData, null, 2));
        await writable.close();
        
        console.log('✅ data.json 저장 완료');
        return true;
    } catch (error) {
        console.error('❌ JSON 파일 저장 실패:', error);
        return false;
    }
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
    // ID가 없으면 생성 (파일에서 불러온 경우)
    if (!summary.id) {
        summary.id = Date.now();
    }
    
    const tabId = `summary_${summary.id}`;
    
    // 이미 열려있으면 해당 탭으로 전환
    if (openTabs.has(tabId)) {
        switchToTab(tabId);
        return;
    }
    
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

// HTML 파일을 iframe으로 표시하는 탭 생성
function createHtmlViewerTab(tabId, title, htmlContent, fileHandle) {
    // 이미 열려있으면 해당 탭으로 전환
    if (openTabs.has(tabId)) {
        switchToTab(tabId);
        return;
    }
    
    // 탭 정보 저장
    openTabs.set(tabId, {
        id: tabId,
        title: title,
        type: 'html-viewer',
        icon: 'fas fa-file-code',
        closable: true,
        data: { htmlContent, fileHandle }
    });
    
    // 탭 콘텐츠 생성
    const tabContents = document.querySelector('.tab-contents');
    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content';
    tabContent.id = `${tabId}-content`;
    
    // iframe으로 HTML 표시
    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.srcdoc = htmlContent;
    
    tabContent.appendChild(iframe);
    tabContents.appendChild(tabContent);
    
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

// ========== 로컬 폴더 File System Access API ==========

let rootDirHandle = null;  // 선택한 루트 폴더 핸들 (summary 폴더)
let selectedWorkspaceHandle = null;  // workspace 폴더 핸들 (summary/workspace)
let selectedSubjectHandle = null;  // subject 폴더 핸들 (summary/workspace/subject)
let selectedWorkspacePath = null;  // workspace 이름
let selectedSubjectPath = null;  // subject 이름
let currentContextHandle = null;  // 우클릭한 폴더/파일 핸들
let currentContextParentHandle = null;  // 우클릭한 항목의 부모 핸들
let currentContextLevel = null;  // 현재 컨텍스트의 레벨 (1: workspace, 2: subject)

// 모달에서 workspace 폴더 목록 로드
async function loadWorkspaceFolders(keepSelection = null) {
    const workspaceSelect = document.getElementById('workspaceSelect');
    const subjectInput = document.getElementById('subjectInput');
    
    if (!workspaceSelect) return;
    
    // 현재 선택값 보존 (인자로 전달되거나 기존 선택값)
    const selectedValue = keepSelection || workspaceSelect.value;
    console.log('📌 보존할 선택값:', selectedValue);
    
    // 초기화
    workspaceSelect.innerHTML = '<option value="">-- Workspace 선택 또는 생성 --</option>';
    subjectInput.value = '';
    subjectInput.disabled = true;
    
    if (!rootDirHandle) {
        // 폴더가 열리지 않았어도 경고만 하고 계속 진행 (새로 만들 수 있음)
        console.log('로컬 디렉토리가 열리지 않았습니다. Workspace를 새로 생성할 수 있습니다.');
        return;
    }
    
    try {
        // summary 폴더 안의 workspace 폴더들 로드
        for await (const entry of rootDirHandle.values()) {
            if (entry.kind === 'directory') {
                const option = document.createElement('option');
                option.value = entry.name;
                option.textContent = entry.name;
                workspaceSelect.appendChild(option);
            }
        }
        
        if (workspaceSelect.options.length > 1) {
            console.log(`${workspaceSelect.options.length - 1}개의 Workspace 로드됨`);
        }
        
        // 선택값 복원
        if (selectedValue) {
            workspaceSelect.value = selectedValue;
            console.log('✅ 선택값 복원:', selectedValue);
            // Subject 입력란 활성화를 위해 onWorkspaceChange 호출
            await onWorkspaceChange();
        }
    } catch (error) {
        console.error('Workspace 폴더 로드 실패:', error);
    }
}

// Workspace 선택 시
async function onWorkspaceChange() {
    console.log('🔄 onWorkspaceChange 시작');
    
    const workspaceSelect = document.getElementById('workspaceSelect');
    const subjectInput = document.getElementById('subjectInput');
    const workspacePreview = document.querySelector('.workspace-preview');
    const subjectPreview = document.querySelector('.subject-preview');
    
    const workspaceName = workspaceSelect.value;
    
    if (workspaceName) {
        // 폴더 핸들 가져오기 (실패해도 계속 진행)
        if (rootDirHandle) {
            try {
                selectedWorkspaceHandle = await rootDirHandle.getDirectoryHandle(workspaceName);
            } catch (error) {
                console.log('Workspace 폴더 핸들 가져오기 실패 (계속 진행):', error);
                selectedWorkspaceHandle = null;
            }
        }
        
        selectedWorkspacePath = workspaceName;
        subjectInput.disabled = false;
        
        if (workspacePreview) workspacePreview.textContent = workspaceName;
        if (subjectPreview) subjectPreview.textContent = 'subject';
        
        // 요약 버튼 활성화 체크
        checkSummarizeButtonState();
    } else {
        selectedWorkspaceHandle = null;
        selectedWorkspacePath = null;
        subjectInput.disabled = true;
        subjectInput.value = '';
        
        if (subjectPreview) workspacePreview.textContent = 'workspace';
        if (subjectPreview) subjectPreview.textContent = 'subject';
        
        disableSummarizeButton();
    }
    
    console.log('✅ onWorkspaceChange 완료');
}

// 새 Workspace 생성
async function createNewWorkspace(event) {
    // 페이지 새로고침 방지
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    console.log('➕ createNewWorkspace 시작');
    
    const workspaceName = prompt('새 Workspace 이름을 입력하세요\n(예: 자료구조, 알고리즘, 운영체제)');
    if (!workspaceName) {
        console.log('취소됨');
        return;
    }
    
    // 유효성 검사
    if (!/^[a-zA-Z0-9가-힣_\-\s]+$/.test(workspaceName)) {
        showNotification('error', 'Workspace 이름에는 특수문자를 사용할 수 없습니다.');
        return;
    }
    
    // 로컬 폴더가 열리지 않았어도 이름만 추가 (백엔드에서 관리)
    const workspaceSelect = document.getElementById('workspaceSelect');
    
    if (rootDirHandle) {
        try {
            console.log('📁 Workspace 폴더 생성 중...');
            // summary 폴더 안에 workspace 생성
            await rootDirHandle.getDirectoryHandle(workspaceName, { create: true });
            showNotification('success', `Workspace '${workspaceName}'가 생성되었습니다.`);
            
            console.log('🔄 loadWorkspaceFolders 호출 전');
            // 목록 새로고침 (새로 만든 workspace 유지)
            await loadWorkspaceFolders(workspaceName);
            console.log('✅ loadWorkspaceFolders 완료');
            
            // 디렉토리 트리도 새로고침
            console.log('🔄 renderLocalDirectory 호출');
            await renderLocalDirectory();
            console.log('✅ renderLocalDirectory 완료');
        } catch (error) {
            console.error('Workspace 폴더 생성 실패 (계속 진행):', error);
        }
    } else {
        console.log('📝 로컬 폴더 없음 - 드롭다운만 업데이트');
        // 폴더 없어도 드롭다운에 추가
        const option = document.createElement('option');
        option.value = workspaceName;
        option.textContent = workspaceName;
        workspaceSelect.appendChild(option);
        workspaceSelect.value = workspaceName;
        showNotification('info', `Workspace '${workspaceName}' 추가됨 (로컬 폴더 없음)`);
    }
    
    console.log('✅ createNewWorkspace 완료!');
}

// Subject 입력 확인 및 버튼 활성화
function checkSummarizeButtonState() {
    const subjectInput = document.getElementById('subjectInput');
    const hasFiles = selectedFiles.length > 0 || currentAudioFile !== null;
    const hasWorkspace = selectedWorkspacePath !== null;
    const hasSubject = subjectInput && subjectInput.value.trim() !== '';
    
    if (hasFiles && hasWorkspace && hasSubject) {
        enableSummarizeButton();
    } else {
        disableSummarizeButton();
    }
}

// Subject 입력 필드에 이벤트 리스너 추가 (DOMContentLoaded에서 호출)
function setupSubjectInputListener() {
    const subjectInput = document.getElementById('subjectInput');
    if (subjectInput) {
        subjectInput.addEventListener('input', () => {
            const subjectPreview = document.querySelector('.subject-preview');
            if (subjectPreview) {
                subjectPreview.textContent = subjectInput.value.trim() || 'subject';
            }
            checkSummarizeButtonState();
        });
    }
}

// Workspace 선택 드롭다운에 이벤트 리스너 추가 (DOMContentLoaded에서 호출)
function setupWorkspaceSelectListener() {
    const workspaceSelect = document.getElementById('workspaceSelect');
    if (workspaceSelect) {
        workspaceSelect.addEventListener('change', async (e) => {
            console.log('🔄 Workspace 변경 이벤트 발생 (addEventListener)');
            await onWorkspaceChange();
        });
        console.log('✅ Workspace select 이벤트 리스너 등록 완료');
    }
}

// 브라우저 지원 확인
function isFileSystemAccessSupported() {
    return 'showDirectoryPicker' in window;
}

// 폴더 열기
async function openLocalFolder() {
    if (!isFileSystemAccessSupported()) {
        showNotification('error', '이 브라우저는 폴더 접근을 지원하지 않습니다. Chrome이나 Edge를 사용해주세요.');
        return;
    }

    try {
        // 폴더 선택 다이얼로그
        rootDirHandle = await window.showDirectoryPicker({
            mode: 'readwrite'  // 읽기+쓰기 권한
        });

        // IndexedDB에 저장 (다음 방문 시 자동 접근)
        await saveDirectoryHandle(rootDirHandle);

        // 폴더 구조 표시
        await renderLocalDirectory();
        
        showNotification('success', `${rootDirHandle.name} 폴더가 열렸습니다.`);
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('폴더 열기 실패:', error);
            showNotification('error', '폴더 열기에 실패했습니다.');
        }
    }
}

// 폴더 구조 렌더링
async function renderLocalDirectory() {
    if (!rootDirHandle) return;

    const directoryEmpty = document.getElementById('directoryEmpty');
    const directoryTree = document.getElementById('directoryTree');
    const newFolderBtn = document.getElementById('newFolderBtn');

    directoryEmpty.style.display = 'none';
    directoryTree.style.display = 'block';
    newFolderBtn.style.display = 'inline-block';  // 새 폴더 버튼 표시
    directoryTree.innerHTML = '';

    console.log('🌳 디렉토리 트리 렌더링 시작...');
    
    const rootNode = await createLocalDirectoryNode(rootDirHandle, rootDirHandle, 0, null);
    rootNode.classList.add('expanded');  // 루트는 펼쳐진 상태
    
    // 루트 폴더의 자식들 자동 로드
    await loadDirectoryChildren(rootNode, rootDirHandle, rootDirHandle, 0);
    
    directoryTree.appendChild(rootNode);
    
    console.log('✅ 디렉토리 트리 렌더링 완료');
}

// 디렉토리 자식 로드 함수
async function loadDirectoryChildren(node, dirHandle, rootHandle, level) {
    // 이미 로드되었는지 확인
    if (node.querySelector('.dir-children')) {
        return;
    }
    
    const children = document.createElement('div');
    children.className = 'dir-children';
    
    try {
        const entries = [];
        for await (const entry of dirHandle.values()) {
            entries.push(entry);
        }
        
        // 폴더 먼저, 파일 나중에 정렬
        entries.sort((a, b) => {
            if (a.kind === b.kind) return a.name.localeCompare(b.name);
            return a.kind === 'directory' ? -1 : 1;
        });
        
        for (const entry of entries) {
            if (entry.kind === 'directory') {
                // 하위 폴더
                const childNode = await createLocalDirectoryNode(entry, rootHandle, level + 1, dirHandle);
                children.appendChild(childNode);
            } else if (entry.kind === 'file') {
                // 파일 노드 생성
                const fileNode = createLocalFileNode(entry, level + 1, dirHandle);
                children.appendChild(fileNode);
            }
        }
        
        console.log(`📁 "${dirHandle.name}" 폴더: ${entries.length}개 항목 로드됨`);
    } catch (error) {
        console.error('폴더 읽기 실패:', error);
    }
    
    node.appendChild(children);
}

// 디렉토리 노드 생성 (재귀)
async function createLocalDirectoryNode(dirHandle, rootHandle, level, parentHandle) {
    const node = document.createElement('div');
    node.className = 'dir-node directory';
    node.dataset.name = dirHandle.name;
    node.dataset.level = level;  // 레벨 저장

    const content = document.createElement('div');
    content.className = 'dir-node-content';
    content.style.paddingLeft = `${level * 12}px`;

    // 화살표
    const arrow = document.createElement('span');
    arrow.className = 'dir-arrow';
    arrow.innerHTML = '<i class="fas fa-chevron-right"></i>';
    content.appendChild(arrow);

    // 폴더 아이콘
    const icon = document.createElement('i');
    icon.className = 'fas fa-folder';
    content.appendChild(icon);

    // 폴더명
    const name = document.createElement('span');
    name.textContent = dirHandle.name;
    content.appendChild(name);

    // 클릭 이벤트 (펼치기/접기)
    content.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        if (!node.classList.contains('expanded')) {
            // 펼치기
            node.classList.add('expanded');
            
            // 자식이 아직 없으면 로드
            await loadDirectoryChildren(node, dirHandle, rootHandle, level);
        } else {
            // 접기
            node.classList.remove('expanded');
        }
    });

    // 우클릭 이벤트 (컨텍스트 메뉴)
    content.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        currentContextHandle = dirHandle;
        currentContextParentHandle = parentHandle;
        currentContextLevel = level;  // 레벨 저장
        showContextMenu(e);
    });

    node.appendChild(content);
    return node;
}

// 파일 노드 생성
function createLocalFileNode(fileHandle, level, parentHandle) {
    const node = document.createElement('div');
    node.className = 'dir-node file';
    node.dataset.name = fileHandle.name;

    const content = document.createElement('div');
    content.className = 'dir-node-content';
    content.style.paddingLeft = `${level * 12}px`;

    // 파일 아이콘
    const icon = document.createElement('i');
    icon.className = 'fas fa-file-alt';
    content.appendChild(icon);

    // 파일명
    const name = document.createElement('span');
    name.textContent = fileHandle.name;
    content.appendChild(name);

    // 클릭 이벤트 (파일 열기)
    content.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        // HTML 파일이면 data.json도 함께 읽어서 탭 생성
        if (fileHandle.name.endsWith('.html')) {
            try {
                console.log('📄 HTML 파일 클릭:', fileHandle.name);
                
                // 같은 폴더에서 data.json 찾기
                if (!parentHandle) {
                    showNotification('error', '폴더 정보를 찾을 수 없습니다.');
                    return;
                }
                
                try {
                    // data.json 읽기
                    const jsonHandle = await parentHandle.getFileHandle('data.json');
                    const jsonFile = await jsonHandle.getFile();
                    const jsonText = await jsonFile.text();
                    const data = JSON.parse(jsonText);
                    
                    console.log('📄 data.json 로드됨:', data);
                    
                    // summary 객체 구성
                    const summary = {
                        ...data,
                        type: 'saved'
                    };
                    
                    // 오디오 파일 찾기
                    const audioFileName = data.fileName;
                    console.log('🔍 오디오 파일 검색 시작:', { audioFileName, parentHandle: parentHandle?.name });
                    
                    if (audioFileName && parentHandle) {
                        try {
                            // 폴더 내 모든 파일 출력 및 오디오 파일 찾기
                            console.log('📂 폴더 내 파일 목록:');
                            let foundAudio = false;
                            
                            for await (const entry of parentHandle.values()) {
                                console.log('  -', entry.kind, entry.name);
                                
                                // 오디오 파일 찾기 (정확한 이름 매칭)
                                if (entry.kind === 'file' && entry.name === audioFileName) {
                                    console.log('🎯 오디오 파일 발견!', entry.name);
                                    const audioFile = await entry.getFile();
                                    const audioUrl = URL.createObjectURL(audioFile);
                                    summary.audioUrl = audioUrl;
                                    summary.fileSize = audioFile.size;
                                    foundAudio = true;
                                    console.log('✅ 오디오 파일 로드 성공:', audioFileName);
                                }
                            }
                            
                            if (!foundAudio) {
                                console.warn('⚠️ 오디오 파일을 찾지 못함:', audioFileName);
                            }
                            
                        } catch (audioError) {
                            console.error('❌ 오디오 파일 로드 실패:', audioError);
                            console.error('찾으려던 파일명:', audioFileName);
                        }
                    } else {
                        console.warn('⚠️ 오디오 파일명 또는 부모 핸들 없음');
                    }
                    
                    // content 필드가 summary 키에 있을 수 있음
                    if (data.summary && !data.content) {
                        summary.content = data.summary;
                    }
                    
                    console.log('🎨 createSummaryTab 호출 직전, summary:', summary);
                    
                    // 탭 생성 (요약 생성 직후와 동일한 UI)
                    createSummaryTab(summary);
                    showNotification('success', `${data.title || fileHandle.name} 불러오기 완료`);
                    return;  // 성공하면 여기서 종료
                    
                } catch (jsonError) {
                    console.error('❌ 탭 생성 중 오류:', jsonError);
                    console.error('에러 스택:', jsonError.stack);
                    showNotification('error', `탭 생성 실패: ${jsonError.message}`);
                }
                
            } catch (error) {
                console.error('❌ HTML 파일 로드 실패:', error);
                showNotification('error', 'HTML 파일을 불러올 수 없습니다.');
            }
            return;
        }
        
        // data.json 파일이면 불러와서 탭으로 표시
        if (fileHandle.name === 'data.json') {
            try {
                const file = await fileHandle.getFile();
                const text = await file.text();
                const data = JSON.parse(text);
                
                console.log('📄 data.json 로드됨:', data);
                
                // summary 객체 기본 구성 (오디오 없어도 표시)
                const summary = {
                    ...data,
                    type: 'saved'
                };
                
                // 오디오 파일 읽기 시도
                const audioFileName = data.fileName;
                if (audioFileName && parentHandle) {
                    try {
                        console.log(`🔍 오디오 파일 찾는 중: "${audioFileName}" in`, parentHandle.name);
                        
                        // 폴더 내 파일 순회하며 찾기
                        for await (const entry of parentHandle.values()) {
                            if (entry.kind === 'file' && entry.name === audioFileName) {
                                console.log('🎯 오디오 파일 발견!', entry.name);
                                const audioFile = await entry.getFile();
                                const audioUrl = URL.createObjectURL(audioFile);
                                summary.audioUrl = audioUrl;
                                summary.fileSize = audioFile.size;
                                console.log('✅ 오디오 파일 로드 성공');
                                break;
                            }
                        }
                        
                    } catch (audioError) {
                        console.warn('⚠️ 오디오 파일 없음 (계속 진행):', audioError.message);
                        // 오디오 없어도 요약은 표시
                    }
                }
                
                // content 필드가 summary 키에 있을 수 있음
                if (data.summary && !data.content) {
                    summary.content = data.summary;
                }
                
                // 탭 생성
                createSummaryTab(summary);
                showNotification('success', `${data.title || '요약'} 불러오기 완료`);
                
            } catch (error) {
                console.error('❌ JSON 파일 로드 실패:', error);
                showNotification('error', 'JSON 파일을 불러올 수 없습니다.');
            }
        } else {
            showNotification('info', `${fileHandle.name} 파일을 선택했습니다.`);
        }
    });

    // 우클릭 이벤트 (파일도 삭제 가능)
    content.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        currentContextHandle = fileHandle;
        currentContextParentHandle = parentHandle;
        showContextMenu(e);
    });

    node.appendChild(content);
    return node;
}

// 컨텍스트 메뉴 표시
function showContextMenu(e) {
    const menu = document.getElementById('contextMenu');
    menu.style.display = 'block';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';

    // 다른 곳 클릭 시 메뉴 닫기
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.style.display = 'none';
            document.removeEventListener('click', closeMenu);
        });
    }, 0);
}

// 새 폴더 생성 (실제 파일시스템에)
async function createNewFolderInLocal() {
    if (!currentContextHandle) {
        showNotification('error', '폴더를 선택해주세요.');
        return;
    }

    const folderName = prompt('새 폴더 이름을 입력하세요:');
    if (!folderName) return;

    // 유효성 검사
    if (!/^[a-zA-Z0-9가-힣_\-\s]+$/.test(folderName)) {
        showNotification('error', '폴더 이름에는 특수문자를 사용할 수 없습니다.');
        return;
    }

    try {
        // 실제 파일시스템에 폴더 생성!
        await currentContextHandle.getDirectoryHandle(folderName, { create: true });
        
        showNotification('success', `폴더 '${folderName}'이(가) 생성되었습니다.`);
        
        // 현재 탭 저장
        const currentPanel = getCurrentSidebarPanel();
        
        // 트리 새로고침
        await renderLocalDirectory();
        
        // 탭 복원
        if (currentPanel) {
            switchSidebarPanel(currentPanel);
        }
    } catch (error) {
        console.error('폴더 생성 실패:', error);
        showNotification('error', '폴더 생성에 실패했습니다.');
    }
}

// 새 폴더 생성 (버튼에서 호출 - 루트에 생성)
async function createNewFolderFromButton() {
    if (!rootDirHandle) {
        showNotification('error', '먼저 폴더를 열어주세요.');
        return;
    }

    const folderName = prompt('새 폴더 이름을 입력하세요:');
    if (!folderName) return;

    // 유효성 검사
    if (!/^[a-zA-Z0-9가-힣_\-\s]+$/.test(folderName)) {
        showNotification('error', '폴더 이름에는 특수문자를 사용할 수 없습니다.');
        return;
    }

    try {
        // 루트 폴더에 새 폴더 생성
        await rootDirHandle.getDirectoryHandle(folderName, { create: true });
        
        showNotification('success', `폴더 '${folderName}'이(가) 생성되었습니다.`);
        
        // 현재 탭 저장
        const currentPanel = getCurrentSidebarPanel();
        
        // 트리 새로고침
        await renderLocalDirectory();
        
        // 탭 복원
        if (currentPanel) {
            switchSidebarPanel(currentPanel);
        }
    } catch (error) {
        console.error('폴더 생성 실패:', error);
        showNotification('error', '폴더 생성에 실패했습니다.');
    }
}

// 작업 폴더로 설정
// 작업 폴더로 설정 (workspace 또는 subject 선택)
function selectWorkspaceFolder() {
    if (!currentContextHandle) {
        showNotification('error', '폴더를 선택해주세요.');
        return;
    }

    // 폴더만 선택 가능
    if (currentContextHandle.kind !== 'directory') {
        showNotification('error', '폴더만 선택할 수 있습니다.');
        return;
    }

    // 레벨 확인: 1 = workspace, 2 = subject
    if (currentContextLevel === 1) {
        // workspace 폴더 선택 (1레벨)
        selectedWorkspaceHandle = currentContextHandle;
        selectedWorkspacePath = currentContextHandle.name;
        selectedSubjectHandle = null;
        selectedSubjectPath = null;
        
        // UI 업데이트
        document.querySelectorAll('.dir-node').forEach(node => {
            node.classList.remove('workspace-folder', 'subject-folder');
        });
        
        const allNodes = document.querySelectorAll('.dir-node');
        allNodes.forEach(node => {
            if (node.dataset.name === selectedWorkspacePath && node.classList.contains('directory')) {
                node.classList.add('workspace-folder');
            }
        });
        
        showNotification('success', `Workspace: '${selectedWorkspacePath}' 선택됨. Subject 폴더를 선택하거나 생성해주세요.`);
        
    } else if (currentContextLevel === 2) {
        // subject 폴더 선택 (2레벨) - 부모가 workspace
        if (!selectedWorkspaceHandle || selectedWorkspaceHandle !== currentContextParentHandle) {
            showNotification('error', '먼저 상위 workspace 폴더를 선택해주세요.');
            return;
        }
        
        selectedSubjectHandle = currentContextHandle;
        selectedSubjectPath = currentContextHandle.name;
        
        // UI 업데이트
        document.querySelectorAll('.dir-node').forEach(node => {
            node.classList.remove('subject-folder');
        });
        
        const allNodes = document.querySelectorAll('.dir-node');
        allNodes.forEach(node => {
            if (node.dataset.name === selectedSubjectPath && node.classList.contains('directory')) {
                node.classList.add('subject-folder');
            }
        });
        
        showNotification('success', `Subject: '${selectedSubjectPath}' 선택됨 (Workspace: ${selectedWorkspacePath})`);
        
    } else {
        showNotification('error', 'summary 폴더 아래의 workspace(1레벨) 또는 subject(2레벨) 폴더만 선택할 수 있습니다.');
    }
}

// 폴더 또는 파일 삭제
async function deleteFolderOrFile() {
    if (!currentContextHandle) {
        showNotification('error', '삭제할 항목을 선택해주세요.');
        return;
    }

    const itemName = currentContextHandle.name;
    const isDirectory = currentContextHandle.kind === 'directory';
    const itemType = isDirectory ? '폴더' : '파일';

    // 삭제 확인
    const confirmed = confirm(`정말로 '${itemName}' ${itemType}를 삭제하시겠습니까?\n\n⚠️ 이 작업은 실제 파일시스템에서 영구적으로 삭제되며 복구할 수 없습니다.`);
    if (!confirmed) return;

    try {
        // 부모 핸들 찾기 (rootDirHandle에서 삭제)
        const parentHandle = currentContextParentHandle || rootDirHandle;
        
        await parentHandle.removeEntry(itemName, { recursive: true });
        
        showNotification('success', `'${itemName}' ${itemType}가 삭제되었습니다.`);
        
        // 선택된 작업 폴더가 삭제된 경우 초기화
        if (selectedWorkspaceHandle === currentContextHandle) {
            selectedWorkspaceHandle = null;
            selectedWorkspacePath = null;
        }
        if (selectedSubjectHandle === currentContextHandle) {
            selectedSubjectHandle = null;
            selectedSubjectPath = null;
        }
        
        // 현재 탭 저장
        const currentPanel = getCurrentSidebarPanel();
        
        // 디렉토리 트리 새로고침
        await renderLocalDirectory();
        
        // 탭 복원
        if (currentPanel) {
            switchSidebarPanel(currentPanel);
        }
    } catch (error) {
        console.error('삭제 실패:', error);
        showNotification('error', `${itemType} 삭제에 실패했습니다: ${error.message}`);
    }
}

// 폴더 새로고침
async function refreshDirectories() {
    if (rootDirHandle) {
        // 현재 탭 저장
        const currentPanel = getCurrentSidebarPanel();
        
        await renderLocalDirectory();
        
        // 탭 복원
        if (currentPanel) {
            switchSidebarPanel(currentPanel);
        }
        
        showNotification('success', '디렉토리가 새로고침되었습니다.');
    } else {
        showNotification('info', '먼저 폴더를 열어주세요.');
    }
}

// IndexedDB에 폴더 핸들 저장
async function saveDirectoryHandle(dirHandle) {
    const db = await openDB();
    const tx = db.transaction('folders', 'readwrite');
    const store = tx.objectStore('folders');
    await store.put({ id: 'root', handle: dirHandle });
    await tx.done;
}

// IndexedDB에서 폴더 핸들 불러오기
async function loadDirectoryHandle() {
    try {
        const db = await openDB();
        const tx = db.transaction('folders', 'readonly');
        const store = tx.objectStore('folders');
        const data = await store.get('root');
        
        if (data && data.handle) {
            // 권한 확인
            const permission = await data.handle.queryPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                rootDirHandle = data.handle;
                await renderLocalDirectory();
            } else {
                // 권한 재요청
                const newPermission = await data.handle.requestPermission({ mode: 'readwrite' });
                if (newPermission === 'granted') {
                    rootDirHandle = data.handle;
                    await renderLocalDirectory();
                }
            }
        }
    } catch (error) {
        console.error('폴더 핸들 불러오기 실패:', error);
    }
}

// IndexedDB 열기
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('LocalFolderDB', 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('folders')) {
                db.createObjectStore('folders', { keyPath: 'id' });
            }
        };
    });
}

// 페이지 로드 시 이전 폴더 자동 로드
document.addEventListener('DOMContentLoaded', async () => {
    if (isFileSystemAccessSupported()) {
        await loadDirectoryHandle();
    }
});
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
        case 'summary':
            btns[0].classList.add('active');
            // 백엔드에서 받은 요약본 또는 Mock 데이터 사용
            const summaryContent = summary?.content || generateMockSummary();
            output.innerHTML = `
                <div class="content-body">
                    ${markdownToHtml(summaryContent)}
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
            
            // 백엔드에서 받은 화자 구분 데이터 사용
            let speakerHtml = '';
            if (summary?.speakerSegments && summary.speakerSegments.length > 0) {
                speakerHtml = summary.speakerSegments.map(seg => {
                    const startTime = formatTimeFromSeconds(seg.start);
                    const endTime = formatTimeFromSeconds(seg.end);
                    return `<p><strong>[${seg.speaker}]</strong> <span class="timestamp">[${startTime} - ${endTime}]</span><br>${seg.text}</p>`;
                }).join('');
            } else {
                // Mock 데이터
                speakerHtml = `<p><strong>[화자1]</strong> <span class="timestamp">[00:00:00 - 00:00:05]</span><br>HTML은 프로그래밍 언어인가요?</p>
                               <p><strong>[화자2]</strong> <span class="timestamp">[00:00:06 - 00:00:10]</span><br>네, 마크업 언어입니다.</p>`;
            }
            
            output.innerHTML = `
                <div class="content-body speaker-transcript">
                    ${speakerHtml}
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
            console.log('🎵 오디오 탭:', { audioUrl: summary?.audioUrl, fileName: summary?.fileName });
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
                console.warn('⚠️ audioUrl 없음');
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

// 초 단위를 HH:MM:SS 형식으로 변환
function formatTimeFromSeconds(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
        return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
}

// 간단한 마크다운 to HTML 변환
function markdownToHtml(markdown) {
    // markdown이 없으면 빈 문자열 반환
    if (!markdown || typeof markdown !== 'string') {
        console.warn('⚠️ markdownToHtml: invalid input', markdown);
        return '<p>요약 내용이 없습니다.</p>';
    }
    
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
  return name.toLowerCase().trim().replace(/[^\w\-]+/g,'-').replace(/\-+/g,'-');
}
function isAssigned(summaryId){
  return Object.values(projects).some(p => Array.isArray(p.items) && p.items.includes(summaryId));
}

// 프로젝트 생성
function createProjectFolder(){
  const name = (prompt('프로젝트 폴더 이름', '새 프로젝트') || '').trim();
  if (!name) return;
  let id = slugify(name) || `p_${Date.now()}`;
  if (projects[id]) { id = `${id}-${Date.now()}`; }
  projects[id] = { name, items: [], expanded: true };
  saveProjects(); renderProjects();
}

// 프로젝트 이름 바꾸기
function renameProjectFolder(id, e){
  if (e) e.stopPropagation();
  const folder = projects[id]; if (!folder) return;
  const nm = prompt('새 폴더 이름', folder.name);
  if (nm === null) return;
  const name = nm.trim(); if (!name) return;
  folder.name = name;
  saveProjects(); renderProjects();
}

// 프로젝트 삭제
function deleteProjectFolder(id, e){
    if (e) e.stopPropagation();
    const folder = projects[id];
    if (!folder) return;
    if (!confirm(`"${folder.name}" 폴더와 그 안의 모든 요약을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;

    // 폴더 안의 요약들을 먼저 하드 삭제
    const toDelete = Array.isArray(folder.items) ? [...folder.items] : [];
    toDelete.forEach(hardDeleteSummaryById);

    // 폴더 제거
    delete projects[id];
    saveProjects();
    renderProjects();
    updateSummariesList();
    updateRecentItems();
    saveSessionHistory();
    showNotification('success','폴더와 내부 요약이 모두 삭제되었습니다.');
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
function addSummaryToProject(folderId, summaryId){
  const folder = projects[folderId]; if (!folder) return;
  if (!folder.items) folder.items = [];
  // 중복 방지
  if (!folder.items.includes(summaryId)){
    folder.items.push(summaryId);
    // 다른 폴더에 이미 있던 경우 제거(= ‘이동’ 보장)
    Object.entries(projects).forEach(([id, f])=>{
      if (id!==folderId && Array.isArray(f.items)) {
        f.items = f.items.filter(x => x!==summaryId);
      }
    });
    saveProjects();
    renderProjects();          // 폴더 내부 반영
    updateSummariesList();     // 아래 ‘요약본(미지정)’에서 제거
    showNotification('success','프로젝트로 이동했습니다.');
  }
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
function deleteSummary(id, e) {
  if (e) e.stopPropagation(); // 항목 클릭 열기 방지

  const idx = findSummaryIndexById(id);
  if (idx === -1) return;

  const summary = sessionHistory[idx];
  if (!confirm(`"${summary.title}" 을(를) 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;

  // 1) 히스토리에서 제거
  sessionHistory.splice(idx, 1);

  // 2) 파일시스템에서 제거
  removeFromFileSystem(summary);

  // 3) 열려있는 탭 닫기
  const tabId = `summary_${summary.id}`;
  if (openTabs.has(tabId)) {
    closeTab(tabId);
  }

  // 4) UI/저장 갱신
  updateSummariesList();
  updateRecentItems();
  saveSessionHistory();

  showNotification('success', '요약이 삭제되었습니다.');
}

// 사이드바에서 이름 바꾸기(제목만)
function renameSummary(id, e) {
  if (e) e.stopPropagation(); // 항목 클릭 열기 방지

  const idx = findSummaryIndexById(id);
  if (idx === -1) return;

  const current = sessionHistory[idx];
  const proposed = prompt('새 이름을 입력하세요.', current.title);
  if (proposed === null) return; // 취소
  const newTitle = proposed.trim();
  if (!newTitle) {
    showNotification('error', '이름은 비워둘 수 없습니다.');
    return;
  }

  // 1) 히스토리 수정
  current.title = newTitle;

  // 2) 파일시스템의 summary 참조도 같은 객체를 바라보므로 따로 수정할 필요는 없음
  // (파일명은 그대로 두고 제목만 변경)

  // 3) 열려있는 탭 제목 갱신
  updateOpenTabTitle(id, newTitle);

  // 4) UI/저장 갱신
  updateSummariesList();
  updateRecentItems();
  saveSessionHistory();

  showNotification('success', '이름이 변경되었습니다.');
}

// 모든 요약 삭제
function clearAllSummaries() {
    if (confirm('모든 요약 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
        sessionHistory = [];
        
        // 파일 시스템 초기화
        fileSystem['/'].children.recordings.children = {};
        fileSystem['/'].children.summaries.children = {};
        
        // 열려있는 요약 탭들 닫기
        const summaryTabs = Array.from(openTabs.keys()).filter(id => id.startsWith('summary_'));
        summaryTabs.forEach(tabId => closeTab(tabId));
        
        // UI 업데이트
        if (document.getElementById('recordingsFolder') || document.getElementById('summariesFolder')) {
            updateFileTree();
        }
        updateSummariesList();
        updateRecentItems();
        saveSessionHistory();
        
        showNotification('success', '모든 요약 기록이 삭제되었습니다.');
    }
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
  baseURL: 'http://localhost:8000',  // 백엔드 주소
  endpoints: {
    transcribe: '/summary-jobs'  // 실제 엔드포인트
  },
  defaultHeaders: {},
  timeoutMs: 120_000,
  useMockMode: false  // 🚀 실제 백엔드 사용! (CORS 해결됨)
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
    const workspace = opts.workspace || '기본프로젝트';
    const subject = opts.subject || `강의 녹음 - ${new Date().toLocaleString('ko-KR')}`;

    console.log('전송할 데이터:', { workspace, subject, fileName: file.name });

    // Mock 모드 - 백엔드 없이 테스트
    if (API_CONFIG.useMockMode) {
        console.log('🧪 Mock 모드: 실제 API 호출 없이 시뮬레이션');
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 지연
        
        return {
            id: Date.now(),
            title: `${workspace} - ${subject}`,
            subject_id: null,
            status: 'COMPLETED',
            final_summary: `# ${subject} 강의 요약 (Mock)\n\n## 📚 주요 내용\n\n이것은 테스트용 Mock 데이터입니다.\n\n### 핵심 개념\n- 개념 1: 자료구조의 기본 개념\n- 개념 2: 배열과 리스트의 차이\n- 개념 3: 시간 복잡도 분석\n\n## 💡 중요 포인트\n\n강의에서 다룬 핵심 내용들입니다.\n- 배열은 고정 크기, 리스트는 동적 크기\n- Big-O 표기법 이해하기\n- 실습 과제 주의사항\n\n## 📝 요약\n\n백엔드 서버가 실행되지 않았습니다. 실제 요약을 생성하려면:\n1. \`cd /Users/max/Desktop/Team10-Decimal/apps/api\`\n2. \`pip install fastapi uvicorn sqlalchemy\`\n3. \`uvicorn main:app --reload --port 8000\`\n\n그 후 \`API_CONFIG.useMockMode = false\`로 설정하세요.`,
            source_materials: [{
                id: 1,
                original_filename: file.name,
                speaker_attributed_segments: [
                    {
                        speaker_label: 'Speaker 1',
                        start_time_seconds: 0.5,
                        end_time_seconds: 5.2,
                        text: '안녕하세요, 오늘은 자료구조의 기본 개념에 대해 알아보겠습니다.'
                    },
                    {
                        speaker_label: 'Speaker 1',
                        start_time_seconds: 5.5,
                        end_time_seconds: 12.8,
                        text: '먼저 배열과 리스트의 차이점부터 살펴보죠. 배열은 고정된 크기를 가지고 있습니다.'
                    },
                    {
                        speaker_label: 'Speaker 2',
                        start_time_seconds: 13.0,
                        end_time_seconds: 18.5,
                        text: '질문 있습니다. 그럼 배열은 크기를 변경할 수 없나요?'
                    },
                    {
                        speaker_label: 'Speaker 1',
                        start_time_seconds: 19.0,
                        end_time_seconds: 25.3,
                        text: '맞습니다. 배열은 생성 시 정한 크기를 변경할 수 없어요. 반면 리스트는 동적으로 크기가 조절됩니다.'
                    },
                    {
                        speaker_label: 'Speaker 1',
                        start_time_seconds: 26.0,
                        end_time_seconds: 33.7,
                        text: '다음으로 시간 복잡도에 대해 알아볼까요? Big-O 표기법을 사용해서 알고리즘의 효율성을 나타냅니다.'
                    }
                ]
            }],
            created_at: new Date().toISOString(),
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString()
        };
    }

    // 실제 API 호출
    const url = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.transcribe}`;
    
    const fd = new FormData();
    fd.append('files', file, file.name);
    fd.append('title', `${workspace} - ${subject}`);  // 백엔드는 title을 받음
    fd.append('korean_only', koreanOnly ? 'true' : 'false');  // 한국어 특화 여부 전송
    // workspace와 subject를 별도로 전달하려면 백엔드 API 수정 필요

    // 🔍 보낼 데이터 로그 출력
    console.log('📤 [백엔드로 전송]', {
        url,
        title: fd.get('title'),
        files: fd.get('files'),
        korean_only: fd.get('korean_only'),
        workspace,
        subject,
        koreanOnly
    });

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), API_CONFIG.timeoutMs);

    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            body: fd,
            signal: ctrl.signal,
            credentials: 'include'
        });
    } catch (fetchError) {
        clearTimeout(to);
        
        if (fetchError.name === 'AbortError') {
            throw new Error('요청 시간 초과 (2분). 파일이 너무 크거나 서버가 응답하지 않습니다.');
        }
        
        console.error('백엔드 서버 연결 실패:', fetchError);
        throw new Error(`백엔드 서버에 연결할 수 없습니다.\n\n서버 실행 방법:\n1. cd /Users/max/Desktop/Team10-Decimal/apps/api\n2. pip install fastapi uvicorn sqlalchemy\n3. uvicorn main:app --reload --port 8000\n\n또는 script.js에서 API_CONFIG.useMockMode = true로 설정`);
    } finally {
        clearTimeout(to);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`전송 실패 ${res.status}: ${text || '서버 오류'}`);
    }
    
    // 백엔드 응답 파싱
    const jobData = await res.json().catch(() => ({}));
    console.log('📥 [백엔드 초기 응답]', jobData);
    
    // Job ID가 있으면 폴링하여 완료 대기
    if (jobData.id && jobData.status !== 'COMPLETED') {
        console.log('⏳ 백그라운드 작업 완료 대기 중... (Job ID:', jobData.id, ')');
        const completedJob = await pollJobCompletion(jobData.id);
        return completedJob;
    }
    
    return jobData;
}

// Job 완료 폴링 함수
async function pollJobCompletion(jobId, maxAttempts = 60, intervalMs = 3000) {
    const pollUrl = `${API_CONFIG.baseURL}/summary-jobs/${jobId}`;
    console.log('🔍 폴링 시작:', pollUrl);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`🔄 폴링 시도 ${attempt}/${maxAttempts}...`);
        
        try {
            const res = await fetch(pollUrl, {
                method: 'GET',
                credentials: 'include'
            });
            
            console.log(`📡 응답 상태: ${res.status}`);
            
            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                console.warn(`⚠️ 폴링 실패 (${res.status}): ${errText}`);
                await new Promise(resolve => setTimeout(resolve, intervalMs));
                continue;
            }
            
            const jobData = await res.json();
            console.log(`📊 Job 상태: ${jobData.status}`, jobData);
            
            if (jobData.status === 'COMPLETED') {
                console.log('✅ 작업 완료!', jobData);
                return jobData;
            } else if (jobData.status === 'FAILED') {
                const errorMsg = jobData.error_message || '백엔드 처리 중 오류 발생';
                throw new Error(errorMsg);
            }
            
            // PENDING 또는 PROCESSING 상태면 계속 대기
            console.log(`⏱️ ${intervalMs/1000}초 후 재시도...`);
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            
        } catch (error) {
            console.error('❌ 폴링 중 오류:', error);
            if (attempt === maxAttempts) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
    }
    
    throw new Error('작업 완료 확인 시간 초과 (3분)');
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
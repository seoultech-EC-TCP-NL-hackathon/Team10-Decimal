// 전역 변수
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordingTimer = null;
let startTime = 0;
let currentAudioFile = null;
let sessionHistory = [];
let openTabs = new Map(); // 열려있는 탭들
let activeTabId = 'welcome';
let tabCounter = 1;
let totalRecordingTime = 0; // 누적 녹음 시간
let hasRecordedData = false; // 녹음 데이터가 있는지 확인
let recordingStartTime = null;
let isModalMinimized = false; // 모달 최소화 상태 플래그
let currentDirectoryHandle = null; // 현재 선택된 디렉토리
let directoryStructure = null; // 디렉토리 구조 캐시

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
    console.log('강의 요약 AI가 로드되었습니다.');

    initializeApp();
    loadSessionHistory();
    initializeTabs();
    setupSidebarTabs();

    // 기본적으로 탐색기 패널 표시
    switchSidebarPanel('explorer');
});

// 앱 초기화
function initializeApp() {
    checkMicrophonePermission();
    setupEventListeners();
    updateSummariesList();
    
    // 기본적으로 탐색기 패널 표시
    switchSidebarPanel('explorer');
    
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
    
    if (type === 'recording') {
        title.textContent = '실시간 녹음';
        recordingControls.style.display = 'block';
        uploadControls.style.display = 'none';
        
        // 새 녹음 시작 시 모든 상태 초기화
        totalRecordingTime = 0;
        recordedChunks = [];
        hasRecordedData = false;
        isRecording = false;
        recordingStartTime = null;
        currentAudioFile = null;
        
        // UI를 초기 상태로 리셋
        resetToRecordingButton();
    } else {
        title.textContent = '파일 업로드';
        recordingControls.style.display = 'none';
        uploadControls.style.display = 'block';
        
        // 파일 업로드 모드일 때도 초기화
        currentAudioFile = null;
    }
    
    modal.classList.add('show');
    disableSummarizeButton();
    resetRecordingUI();
    isModalMinimized = false;
    hideRecordingMinibar();
}

// 녹음 모달 닫기
function closeRecordingModal(keepState = false) {
  const modal = document.getElementById('recordingModal');
  modal.classList.remove('show');

  // 녹음 중이면 중지
  if (isRecording) {
    toggleRecording();
  }

  // 상태 초기화 (요약 버튼에서 닫을 때는 keepState=true로 상태 유지)
  if (!keepState) {
    currentAudioFile = null;
    disableSummarizeButton();
    const fileInput = document.getElementById('audioFile');
    if (fileInput) fileInput.value = '';
  }
  
  isModalMinimized = false;
  hideRecordingMinibar();
}

// 모달 최소화 (내리기)
function minimizeRecordingModal() {
    const modal = document.getElementById('recordingModal');
    if (!modal) return;
    modal.classList.remove('show');
    isModalMinimized = true;
    showRecordingMinibar();
    updateMinibarUI();
}

// 모달 복원 (미니바 클릭 시)
function restoreRecordingModal() {
    const modal = document.getElementById('recordingModal');
    const minibar = document.getElementById('recordingMinibar');
    if (modal) modal.classList.add('show');
    if (minibar) minibar.style.display = 'none';
    isModalMinimized = false;
}

// 미니바 표시/숨김
function showRecordingMinibar() {
    const minibar = document.getElementById('recordingMinibar');
    if (!minibar) return;
    minibar.style.display = 'flex';
    updateMinibarUI();
}

function hideRecordingMinibar() {
    const minibar = document.getElementById('recordingMinibar');
    if (!minibar) return;
    minibar.style.display = 'none';
}

// 미니바 UI 갱신
function updateMinibarUI() {
    const minibar = document.getElementById('recordingMinibar');
    if (!minibar || minibar.style.display === 'none') return;

    const statusEl = document.getElementById('minibarStatus');
    if (statusEl) {
        if (isRecording) statusEl.textContent = '녹음 중';
        else if (hasRecordedData) statusEl.textContent = '녹음 완료';
        else statusEl.textContent = '대기';
    }
    
    // 녹음 중일 때 활성화 클래스 추가/제거
    minibar.classList.toggle('active', !!isRecording);

    // 타이머 텍스트 갱신 (updateTimer에서 처리됨)
}

// 파일 이름 모달 표시
function showFileNameModal() {
    const modal = document.getElementById('fileNameModal');
    const input = document.getElementById('summaryFileName');
    
    // 기본 제목을 현재 날짜로 설정
    const now = new Date();
    const defaultTitle = `강의요약_${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
    
    input.value = defaultTitle;
    modal.style.display = 'flex';
    
    // 입력 필드에 포커스
    setTimeout(() => {
        input.focus();
        input.select(); // 전체 텍스트 선택
    }, 100);
    
    // Enter 키로 확인
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            confirmFileName();
        } else if (e.key === 'Escape') {
            closeFileNameModal();
        }
    });
}

// 파일 이름 모달 닫기
function closeFileNameModal() {
    const modal = document.getElementById('fileNameModal');
    modal.style.display = 'none';
}

// 파일 이름 확인
async function confirmFileName() {
    const input = document.getElementById('summaryFileName');
    const summaryTitle = input.value.trim();
    
    if (!summaryTitle) {
        showNotification('error', '요약 제목을 입력해야 합니다.');
        input.focus();
        return;
    }
    
    // 모달들 닫기
    closeFileNameModal();
    closeRecordingModal(true);
    
    // 요약 생성 시작
    showLoading(true);
    try {
        await simulateSummarization(summaryTitle);
    } catch (error) {
        console.error('요약 실패:', error);
        showNotification('error', '요약 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
        showLoading(false);
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
            clearInterval(recordingTimer);
            document.getElementById('recordingTimer').textContent = '00:00';

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
                hasRecordedData = true; // 녹음 데이터가 있음을 표시
                
                // 누적 녹음 시간 업데이트
                if (recordingStartTime) {
                    totalRecordingTime += Date.now() - recordingStartTime;
                }
                
                // UI를 녹음 완료 상태로 변경
                updateRecordingButtons();
                enableSummarizeButton();
                
                // 미니바 UI 업데이트
                updateMinibarUI();
                
                showNotification('success', '녹음이 완료되었습니다!');
            };
            
            mediaRecorder.start();
            isRecording = true;
            recordingStartTime = Date.now();
            
            // UI 업데이트
            recordBtn.classList.add('recording');
            recordBtn.innerHTML = '<i class="fas fa-stop"></i><span>녹음 중지</span>';
            statusText.textContent = '녹음 중';
            timer.classList.add('active');
            
            // 타이머 시작
            recordingTimer = setInterval(updateTimer, 1000);
            
            // 미니바 UI 업데이트
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
        
        // UI는 onstop 이벤트에서 처리됩니다
    }
}

// 녹음 타이머 업데이트
function updateTimer() {
    const elapsed = isRecording && recordingStartTime
        ? totalRecordingTime + (Date.now() - recordingStartTime)
        : totalRecordingTime;
    
    const totalSeconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    // 모달의 타이머 업데이트
    const timer = document.getElementById('recordingTimer');
    if (timer) timer.textContent = formatted;
    
    // 미니바의 타이머 업데이트
    const minibarTimer = document.getElementById('minibarTimer');
    if (minibarTimer) minibarTimer.textContent = formatted;
}

// 녹음 버튼들 업데이트 (녹음 완료 후)
function updateRecordingButtons() {
    const recordingSection = document.querySelector('.recording-section');
    
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
                    <span class="info-value time">${formatTime(totalRecordingTime)}</span>
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
    try {
        // 원래 녹음 버튼으로 되돌리기
        resetToRecordingButton();
        // 녹음 시작
        await toggleRecording();
    } catch (error) {
        console.error('마이크 접근 오류:', error);
        showNotification('error', '마이크에 접근할 수 없습니다. 브라우저 권한을 확인해주세요.');
    }
}

// 처음부터 녹음
async function restartRecording() {
    if (confirm('기존 녹음을 삭제하고 처음부터 시작하시겠습니까?')) {
        // 모든 녹음 데이터 초기화
        recordedChunks = [];
        totalRecordingTime = 0;
        hasRecordedData = false;
        currentAudioFile = null;
        
        // 원래 녹음 버튼으로 되돌리기
        resetToRecordingButton();
        
        // 요약 버튼 비활성화
        disableSummarizeButton();
        
        try {
            // 녹음 시작
            await toggleRecording();
        } catch (error) {
            console.error('마이크 접근 오류:', error);
            showNotification('error', '마이크에 접근할 수 없습니다. 브라우저 권한을 확인해주세요.');
        }
    }
}

// 원래 녹음 버튼으로 되돌리기
function resetToRecordingButton() {
    const recordingSection = document.querySelector('.recording-section');
    
    recordingSection.innerHTML = `
        <button class="record-btn" id="recordBtn" onclick="toggleRecording()">
            <i class="fas fa-microphone"></i>
            <span>녹음 시작</span>
        </button>
        <div class="recording-status" id="recordingStatus">
            <span class="status-text">준비됨</span>
            <div class="recording-timer" id="recordingTimer">00:00</div>
        </div>
    `;
}

// 파일 업로드 처리
function handleFileUpload(event) {
    const file = event.target.files[0];
    
    if (!file) return;
    
    if (!file.type.startsWith('audio/')) {
        showNotification('error', '오디오 파일만 업로드할 수 있습니다.');
        return;
    }
    
    if (file.size > 100 * 1024 * 1024) {
        showNotification('error', '파일 크기는 100MB 이하여야 합니다.');
        return;
    }
    
    currentAudioFile = file;
    enableSummarizeButton();
    
    showNotification('success', `파일 "${file.name}"이 업로드되었습니다.`);
}

// 요약 생성
async function summarizeAudio() {
  if (!currentAudioFile) {
    showNotification('error', '먼저 오디오를 녹음하거나 파일을 업로드해주세요.');
    return;
  }

  // 파일 이름 입력 모달 표시
  showFileNameModal();
}


// 요약 시뮬레이션
async function simulateSummarization(customTitle) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const timestamp = new Date();
    const fileName = currentAudioFile instanceof File ? 
        currentAudioFile.name : 
        `recording_${timestamp.getTime()}.webm`;
    
    const summary = {
        id: Date.now(),
        title: customTitle || `${fileName} 요약`, // 사용자 입력 제목 또는 기본 제목
        fileName: fileName,
        content: generateMockSummary(),
        timestamp: timestamp.toLocaleString('ko-KR'),
        type: currentAudioFile instanceof File ? 'file' : 'recording'
    };
    
    // 탭으로 요약 결과 표시
    createSummaryTab(summary);
    
    // 파일 시스템에 추가
    addToFileSystem(summary);
    
    // 히스토리에 추가
    addToHistory(summary);
    
    // UI 업데이트
    if (document.getElementById('recordingsFolder') || document.getElementById('summariesFolder')) {
        updateFileTree();
    }   
    updateSummariesList();
    updateRecentItems();
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
          <button class="btn" id="show-plain-${tabId}" onclick="showResult('${tabId}','plain')">전체 텍스트</button>
          
          <button class="btn ghost" title="텍스트 복사" onclick="copyResultText('${tabId}')" style="max-width:120px;">
            <i class="fas fa-copy"></i>&nbsp;<span>복사</span>
          </button>
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
            output.innerHTML = markdownToHtml(generateMockSummary());
            break;
        case 'raw':
            btns[1].classList.add('active');
            output.innerHTML = `<p><strong>[화자1]</strong> HTML은 프로그래밍 언어인가요?<br><strong>[화자2]</strong> 네.</p>`;
            break;
        case 'plain':
            btns[2].classList.add('active');
            output.innerHTML = `<p>안녕하세요. 오늘 수업은 여기까지입니다.</p>`;
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

// ✅ 폴더 DOM이 없으면 조용히 스킵
function updateFileTree() {
  const rec = document.getElementById('recordingsFolder');
  const sum = document.getElementById('summariesFolder');
  if (!rec && !sum) return;
  if (rec) updateFolderContents('recordingsFolder', fileSystem['/'].children.recordings.children);
  if (sum) updateFolderContents('summariesFolder', fileSystem['/'].children.summaries.children);
}

function updateFolderContents(folderId, children) {
  const folder = document.getElementById(folderId);
  if (!folder) return; // ✅ 안전 가드
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

// 요약 리스트 업데이트
function updateSummariesList() {
  const summariesList = document.getElementById('summariesList');

  if (sessionHistory.length === 0) {
    summariesList.innerHTML = '<p style="text-align: center; color: #8c8c8c; padding: 20px;">아직 요약 기록이 없습니다.</p>';
    return;
  }

  summariesList.innerHTML = '';

  sessionHistory.forEach(summary => {
    const summaryElement = document.createElement('div');
    summaryElement.className = 'summary-item';
    summaryElement.onclick = () => openSummaryFromHistory(summary);

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

  // 보통은 '텍스트'만 복사하는 게 안전함 (마크업 제거)
  const text = box.innerText;

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
  const btn = document.querySelector(`#${tabId}-content .result .result-row .btn.ghost`);
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

// ============================================
// 디렉토리 탐색기 기능
// ============================================

// 디렉토리 선택기 열기
async function openDirectoryPicker() {
    try {
        // File System Access API 지원 확인
        if (!('showDirectoryPicker' in window)) {
            showNotification('error', '이 브라우저는 디렉토리 접근을 지원하지 않습니다. Chrome 86+ 또는 Edge 86+를 사용해주세요.');
            return;
        }

        // 디렉토리 선택 (쓰기 권한 포함)
        const directoryHandle = await window.showDirectoryPicker({
            mode: 'readwrite' // 읽기/쓰기 권한 요청
        });

        currentDirectoryHandle = directoryHandle;
        
        // 디렉토리 구조 로드
        await loadDirectoryStructure();
        
        showNotification('success', `"${directoryHandle.name}" 폴더를 열었습니다.`);
        
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('디렉토리 선택 오류:', error);
            showNotification('error', '디렉토리를 선택할 수 없습니다.');
        }
    }
}

// 디렉토리 구조 로드
async function loadDirectoryStructure() {
    if (!currentDirectoryHandle) return;
    
    try {
        const tree = await buildDirectoryTree(currentDirectoryHandle);
        directoryStructure = tree;
        renderDirectoryTree(tree);
    } catch (error) {
        console.error('디렉토리 구조 로드 오류:', error);
        showNotification('error', '디렉토리 구조를 불러올 수 없습니다.');
    }
}

// 디렉토리 트리 구축
async function buildDirectoryTree(directoryHandle, depth = 0) {
    const tree = {
        name: directoryHandle.name,
        type: 'directory',
        handle: directoryHandle,
        children: [],
        expanded: depth < 2 // 첫 2단계까지만 기본 확장
    };

    // 깊이 제한 (성능상)
    if (depth > 3) return tree;

    try {
        for await (const [name, handle] of directoryHandle.entries()) {
            // 숨김 파일/폴더 제외
            if (name.startsWith('.')) continue;
            
            if (handle.kind === 'directory') {
                const subTree = await buildDirectoryTree(handle, depth + 1);
                tree.children.push(subTree);
            } else {
                // 특정 파일 형식만 표시
                const ext = name.split('.').pop()?.toLowerCase();
                if (isDisplayableFile(ext)) {
                    tree.children.push({
                        name: name,
                        type: 'file',
                        handle: handle,
                        extension: ext
                    });
                }
            }
        }
        
        // 폴더 먼저, 파일 나중 순으로 정렬
        tree.children.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        
    } catch (error) {
        console.error(`디렉토리 읽기 오류 (${directoryHandle.name}):`, error);
    }

    return tree;
}

// 표시할 파일인지 확인
function isDisplayableFile(extension) {
    const displayableExtensions = [
        'txt', 'md', 'js', 'ts', 'html', 'css', 'json', 'py', 'java', 'cpp', 'c', 'h',
        'mp3', 'wav', 'm4a', 'mp4', 'avi', 'mov', 'pdf', 'doc', 'docx', 'jpg', 'png', 'gif'
    ];
    return displayableExtensions.includes(extension);
}

// 디렉토리 트리 렌더링
function renderDirectoryTree(tree) {
    const container = document.getElementById('directoryTree');
    container.innerHTML = '';
    
    if (!tree) return;
    
    const rootElement = createTreeNode(tree, 0);
    container.appendChild(rootElement);
    
    // 우클릭 컨텍스트 메뉴 이벤트 추가
    container.addEventListener('contextmenu', handleDirectoryContextMenu);
}

// 트리 노드 생성
function createTreeNode(node, depth) {
    const nodeElement = document.createElement('div');
    nodeElement.className = 'tree-node';
    nodeElement.style.paddingLeft = `${depth * 16}px`;
    
    if (node.type === 'directory') {
        nodeElement.classList.add('directory');
        if (node.expanded) nodeElement.classList.add('expanded');
        
        nodeElement.innerHTML = `
            <div class="tree-node-content" onclick="toggleDirectoryNode(this)">
                <i class="fas ${node.expanded ? 'fa-chevron-down' : 'fa-chevron-right'} expand-icon"></i>
                <i class="fas fa-folder folder-icon"></i>
                <span class="node-name">${node.name}</span>
                <span class="node-count">(${node.children.length})</span>
            </div>
            <div class="tree-children" style="display: ${node.expanded ? 'block' : 'none'}"></div>
        `;
        
        const childrenContainer = nodeElement.querySelector('.tree-children');
        if (node.expanded) {
            node.children.forEach(child => {
                childrenContainer.appendChild(createTreeNode(child, depth + 1));
            });
        }
        
        // 노드에 데이터 저장
        nodeElement._nodeData = node;
        
    } else {
        nodeElement.classList.add('file');
        
        const icon = getFileIcon(node.extension);
        nodeElement.innerHTML = `
            <div class="tree-node-content" onclick="openFileFromTree(this)">
                <i class="fas ${icon} file-icon"></i>
                <span class="node-name">${node.name}</span>
            </div>
        `;
        
        // 노드에 데이터 저장
        nodeElement._nodeData = node;
    }
    
    return nodeElement;
}

// 파일 아이콘 결정
function getFileIcon(extension) {
    const iconMap = {
        'txt': 'fa-file-alt',
        'md': 'fa-file-alt',
        'js': 'fa-file-code',
        'ts': 'fa-file-code',
        'html': 'fa-file-code',
        'css': 'fa-file-code',
        'json': 'fa-file-code',
        'py': 'fa-file-code',
        'java': 'fa-file-code',
        'cpp': 'fa-file-code',
        'c': 'fa-file-code',
        'h': 'fa-file-code',
        'mp3': 'fa-file-audio',
        'wav': 'fa-file-audio',
        'm4a': 'fa-file-audio',
        'mp4': 'fa-file-video',
        'avi': 'fa-file-video',
        'mov': 'fa-file-video',
        'pdf': 'fa-file-pdf',
        'doc': 'fa-file-word',
        'docx': 'fa-file-word',
        'jpg': 'fa-file-image',
        'png': 'fa-file-image',
        'gif': 'fa-file-image'
    };
    
    return iconMap[extension] || 'fa-file';
}

// 디렉토리 노드 토글
function toggleDirectoryNode(element) {
    const nodeElement = element.closest('.tree-node');
    const nodeData = nodeElement._nodeData;
    const childrenContainer = nodeElement.querySelector('.tree-children');
    const expandIcon = nodeElement.querySelector('.expand-icon');
    
    if (nodeData.expanded) {
        // 접기
        nodeData.expanded = false;
        nodeElement.classList.remove('expanded');
        childrenContainer.style.display = 'none';
        expandIcon.classList.remove('fa-chevron-down');
        expandIcon.classList.add('fa-chevron-right');
    } else {
        // 펼치기
        nodeData.expanded = true;
        nodeElement.classList.add('expanded');
        childrenContainer.style.display = 'block';
        expandIcon.classList.remove('fa-chevron-right');
        expandIcon.classList.add('fa-chevron-down');
        
        // 자식 노드들 렌더링 (지연 로딩)
        if (childrenContainer.children.length === 0) {
            const depth = (nodeElement.style.paddingLeft || '0px').replace('px', '') / 16;
            nodeData.children.forEach(child => {
                childrenContainer.appendChild(createTreeNode(child, depth + 1));
            });
        }
    }
}

// 트리에서 파일 열기
async function openFileFromTree(element) {
    const nodeElement = element.closest('.tree-node');
    const nodeData = nodeElement._nodeData;
    
    if (nodeData.type !== 'file') return;
    
    try {
        // 오디오 파일인 경우 업로드 모달에서 사용
        const ext = nodeData.extension.toLowerCase();
        if (['mp3', 'wav', 'm4a', 'mp4'].includes(ext)) {
            const file = await nodeData.handle.getFile();
            currentAudioFile = file;
            enableSummarizeButton();
            showRecordingModal('upload');
            showNotification('success', `"${nodeData.name}" 파일을 선택했습니다.`);
        } else {
            // 텍스트 파일인 경우 내용을 새 탭에서 표시
            const file = await nodeData.handle.getFile();
            const text = await file.text();
            
            // 새 탭 생성
            const tabId = `file_${Date.now()}`;
            openTabs.set(tabId, {
                id: tabId,
                title: nodeData.name,
                type: 'file',
                icon: getFileIcon(nodeData.extension),
                closable: true,
                data: { content: text, fileName: nodeData.name }
            });
            
            createFileTab(tabId, nodeData.name, text);
            switchToTab(tabId);
            updateTabBar();
        }
        
    } catch (error) {
        console.error('파일 열기 오류:', error);
        showNotification('error', '파일을 열 수 없습니다.');
    }
}

// 파일 탭 생성
function createFileTab(tabId, fileName, content) {
    const tabContents = document.querySelector('.tab-contents');
    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content';
    tabContent.id = `${tabId}-content`;

    tabContent.innerHTML = `
        <div class="file-viewer">
            <div class="file-header">
                <div class="file-meta">
                    <h1>${fileName}</h1>
                    <div class="file-info">
                        <span class="file-type">
                            <i class="fas ${getFileIcon(fileName.split('.').pop())}"></i>
                            텍스트 파일
                        </span>
                    </div>
                </div>
                <div class="file-actions">
                    <button class="action-btn" onclick="copyFileContent('${tabId}')" title="복사">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
            </div>
            <div class="file-content">
                <pre><code>${escapeHtml(content)}</code></pre>
            </div>
        </div>
    `;

    tabContents.appendChild(tabContent);
}

// HTML 이스케이프
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// 파일 내용 복사
function copyFileContent(tabId) {
    const tab = openTabs.get(tabId);
    if (!tab || !tab.data) return;
    
    navigator.clipboard.writeText(tab.data.content).then(() => {
        showNotification('success', '파일 내용이 클립보드에 복사되었습니다.');
    }).catch(() => {
        showNotification('error', '복사에 실패했습니다.');
    });
}

// 디렉토리 새로고침
async function refreshDirectory() {
    if (!currentDirectoryHandle) {
        showNotification('error', '먼저 폴더를 선택해주세요.');
        return;
    }
    
    await loadDirectoryStructure();
    showNotification('success', '디렉토리를 새로고침했습니다.');
}

// 컨텍스트 메뉴 처리
function handleDirectoryContextMenu(event) {
    event.preventDefault();
    
    const contextMenu = document.getElementById('contextMenu');
    contextMenu.style.display = 'block';
    contextMenu.style.left = event.clientX + 'px';
    contextMenu.style.top = event.clientY + 'px';
    
    // 클릭한 노드 찾기
    const clickedNode = event.target.closest('.tree-node');
    if (clickedNode) {
        contextMenu._targetNode = clickedNode;
    } else {
        contextMenu._targetNode = null; // 루트 디렉토리
    }
    
    // 다른 곳 클릭 시 메뉴 숨기기
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu);
    }, 0);
}

// 컨텍스트 메뉴 숨기기
function hideContextMenu() {
    const contextMenu = document.getElementById('contextMenu');
    contextMenu.style.display = 'none';
    document.removeEventListener('click', hideContextMenu);
}

// 새 폴더 생성
async function createNewFolder() {
    if (!currentDirectoryHandle) {
        showNotification('error', '먼저 폴더를 선택해주세요.');
        return;
    }
    
    hideContextMenu();
    
    const folderName = prompt('새 폴더 이름을 입력하세요:', 'New Folder');
    if (!folderName || !folderName.trim()) {
        return;
    }
    
    try {
        // 대상 디렉토리 결정
        let targetDirectory = currentDirectoryHandle;
        const contextMenu = document.getElementById('contextMenu');
        
        if (contextMenu._targetNode && contextMenu._targetNode._nodeData) {
            const nodeData = contextMenu._targetNode._nodeData;
            if (nodeData.type === 'directory') {
                targetDirectory = nodeData.handle;
            } else {
                // 파일의 부모 디렉토리 찾기 (간단화를 위해 루트 사용)
                targetDirectory = currentDirectoryHandle;
            }
        }
        
        // 새 폴더 생성
        await targetDirectory.getDirectoryHandle(folderName.trim(), { create: true });
        
        // 디렉토리 구조 새로고침
        await loadDirectoryStructure();
        
        showNotification('success', `"${folderName}" 폴더가 생성되었습니다.`);
        
    } catch (error) {
        console.error('폴더 생성 오류:', error);
        
        if (error.name === 'NotAllowedError') {
            showNotification('error', '폴더 생성 권한이 없습니다. 쓰기 권한이 있는 폴더를 선택해주세요.');
        } else if (error.name === 'TypeMismatchError') {
            showNotification('error', '동일한 이름의 파일이 이미 존재합니다.');
        } else {
            showNotification('error', `폴더 생성 실패: ${error.message}`);
        }
    }
}

// 새 파일 생성
async function createNewFile() {
    if (!currentDirectoryHandle) {
        showNotification('error', '먼저 폴더를 선택해주세요.');
        return;
    }
    
    hideContextMenu();
    
    const fileName = prompt('새 파일 이름을 입력하세요:', 'new-file.txt');
    if (!fileName || !fileName.trim()) {
        return;
    }
    
    try {
        // 대상 디렉토리 결정
        let targetDirectory = currentDirectoryHandle;
        const contextMenu = document.getElementById('contextMenu');
        
        if (contextMenu._targetNode && contextMenu._targetNode._nodeData) {
            const nodeData = contextMenu._targetNode._nodeData;
            if (nodeData.type === 'directory') {
                targetDirectory = nodeData.handle;
            }
        }
        
        // 새 파일 생성
        const fileHandle = await targetDirectory.getFileHandle(fileName.trim(), { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(''); // 빈 파일 생성
        await writable.close();
        
        // 디렉토리 구조 새로고침
        await loadDirectoryStructure();
        
        showNotification('success', `"${fileName}" 파일이 생성되었습니다.`);
        
    } catch (error) {
        console.error('파일 생성 오류:', error);
        
        if (error.name === 'NotAllowedError') {
            showNotification('error', '파일 생성 권한이 없습니다. 쓰기 권한이 있는 폴더를 선택해주세요.');
        } else if (error.name === 'TypeMismatchError') {
            showNotification('error', '동일한 이름의 폴더가 이미 존재합니다.');
        } else {
            showNotification('error', `파일 생성 실패: ${error.message}`);
        }
    }
}

// 파일/폴더 삭제
async function deleteItem() {
    const contextMenu = document.getElementById('contextMenu');
    const targetNode = contextMenu._targetNode;
    
    if (!targetNode || !targetNode._nodeData) {
        showNotification('error', '삭제할 항목을 선택해주세요.');
        return;
    }
    
    hideContextMenu();
    
    const nodeData = targetNode._nodeData;
    const itemType = nodeData.type === 'directory' ? '폴더' : '파일';
    
    if (!confirm(`"${nodeData.name}" ${itemType}를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
        return;
    }
    
    try {
        // File System Access API에는 직접적인 삭제 기능이 없습니다.
        // 브라우저 보안상 제한이 있어서 삭제는 지원되지 않습니다.
        showNotification('error', '브라우저 보안 정책상 파일/폴더 삭제는 지원되지 않습니다.');
        
    } catch (error) {
        console.error('삭제 오류:', error);
        showNotification('error', `삭제 실패: ${error.message}`);
    }
}
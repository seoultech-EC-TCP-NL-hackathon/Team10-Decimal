// API 통신을 위한 설정 및 함수들

// ==== API 기본 설정 ====
const API_BASE_URL = 'http://127.0.0.1:8000';  // FastAPI 서버 주소

// ==== 유틸리티 함수 ====
/**
 * API 요청 시 에러 처리
 */
async function handleResponse(response) {
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`API 오류 (${response.status}): ${errorText || response.statusText}`);
    }
    return response.json();
}

// ==== Workspace API ====

/**
 * 새 워크스페이스 생성
 * @param {string} name - 워크스페이스 이름
 * @param {string} description - 워크스페이스 설명 (선택)
 * @returns {Promise<Object>} 생성된 워크스페이스 정보
 */
async function createWorkspace(name, description = '') {
    const response = await fetch(`${API_BASE_URL}/workspaces`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description }),
    });
    return handleResponse(response);
}

/**
 * 전체 워크스페이스 목록 조회
 * @returns {Promise<Array>} 워크스페이스 목록
 */
async function getWorkspaces() {
    const response = await fetch(`${API_BASE_URL}/workspaces`);
    return handleResponse(response);
}

// ==== Subject API ====

/**
 * 새 과목(Subject) 생성
 * @param {string} name - 과목 이름
 * @param {number} workspaceId - 워크스페이스 ID
 * @param {boolean} isKoreanOnly - 한국어 전용 모델 사용 여부
 * @param {string} description - 과목 설명 (선택)
 * @returns {Promise<Object>} 생성된 과목 정보
 */
async function createSubject(name, workspaceId, isKoreanOnly = false, description = '') {
    const response = await fetch(`${API_BASE_URL}/subjects`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name,
            workspace_id: workspaceId,
            is_korean_only: isKoreanOnly,
            description
        }),
    });
    return handleResponse(response);
}

/**
 * 과목 목록 조회
 * @param {number|null} workspaceId - 특정 워크스페이스의 과목만 조회 (선택)
 * @returns {Promise<Array>} 과목 목록
 */
async function getSubjects(workspaceId = null) {
    const url = workspaceId 
        ? `${API_BASE_URL}/subjects?workspace_id=${workspaceId}`
        : `${API_BASE_URL}/subjects`;
    const response = await fetch(url);
    return handleResponse(response);
}

/**
 * 과목 삭제
 * @param {number} subjectId - 삭제할 과목 ID
 * @returns {Promise<void>}
 */
async function deleteSubject(subjectId) {
    const response = await fetch(`${API_BASE_URL}/subjects/${subjectId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        throw new Error(`과목 삭제 실패 (${response.status})`);
    }
}

// ==== Summary Job API (핵심!) ====

/**
 * 요약 작업 생성 (파일 업로드)
 * @param {string} title - 요약 제목
 * @param {File|Blob} audioFile - 업로드할 오디오 파일
 * @param {number|null} subjectId - 과목 ID (선택, 설정하면 해당 과목의 is_korean_only 설정 사용)
 * @returns {Promise<Object>} 생성된 작업 정보
 */
async function createSummaryJob(title, audioFile, subjectId = null) {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('files', audioFile);
    
    if (subjectId !== null) {
        formData.append('subject_id', subjectId);
    }
    
    const response = await fetch(`${API_BASE_URL}/summary-jobs`, {
        method: 'POST',
        body: formData,
        // FormData 사용 시 Content-Type 헤더는 자동 설정됨
    });
    return handleResponse(response);
}

/**
 * 요약 작업 목록 조회
 * @param {number|null} subjectId - 특정 과목의 작업만 조회 (선택)
 * @returns {Promise<Array>} 작업 목록 (최신순)
 */
async function getSummaryJobs(subjectId = null) {
    const url = subjectId 
        ? `${API_BASE_URL}/summary-jobs?subject_id=${subjectId}`
        : `${API_BASE_URL}/summary-jobs`;
    const response = await fetch(url);
    return handleResponse(response);
}

/**
 * 특정 요약 작업 상세 조회
 * @param {number} jobId - 작업 ID
 * @returns {Promise<Object>} 작업 상세 정보
 */
async function getSummaryJob(jobId) {
    const response = await fetch(`${API_BASE_URL}/summary-jobs/${jobId}`);
    return handleResponse(response);
}

/**
 * 완료된 요약본 다운로드
 * @param {number} jobId - 작업 ID
 * @returns {Promise<string>} 요약본 텍스트 (Markdown)
 */
async function downloadSummary(jobId) {
    const response = await fetch(`${API_BASE_URL}/summary-jobs/${jobId}/download`);
    if (!response.ok) {
        throw new Error(`다운로드 실패 (${response.status})`);
    }
    return response.text();
}

/**
 * 요약 작업 삭제 (파일도 함께 삭제됨)
 * @param {number} jobId - 작업 ID
 * @returns {Promise<Object>} 삭제 결과 메시지
 */
async function deleteSummaryJob(jobId) {
    const response = await fetch(`${API_BASE_URL}/summary-jobs/${jobId}`, {
        method: 'DELETE',
    });
    return handleResponse(response);
}

// ==== 작업 상태 폴링 ====

/**
 * 작업 완료될 때까지 주기적으로 상태 확인
 * @param {number} jobId - 작업 ID
 * @param {Function} onProgress - 진행 상황 콜백 (job 객체 전달)
 * @param {number} intervalMs - 체크 간격 (밀리초, 기본 2초)
 * @returns {Promise<Object>} 완료된 작업 정보
 */
async function pollJobStatus(jobId, onProgress = null, intervalMs = 2000) {
    return new Promise((resolve, reject) => {
        const checkStatus = async () => {
            try {
                const job = await getSummaryJob(jobId);
                
                // 진행 상황 콜백 호출
                if (onProgress) {
                    onProgress(job);
                }
                
                // 상태 확인
                if (job.status === 'completed') {
                    clearInterval(interval);
                    resolve(job);
                } else if (job.status === 'failed') {
                    clearInterval(interval);
                    reject(new Error(`작업 실패: ${job.error_message || '알 수 없는 오류'}`));
                }
                // pending 또는 processing이면 계속 대기
            } catch (error) {
                clearInterval(interval);
                reject(error);
            }
        };
        
        const interval = setInterval(checkStatus, intervalMs);
        checkStatus(); // 즉시 한 번 실행
    });
}

// ==== 화자 구분 텍스트 가져오기 ====

/**
 * 화자 구분 텍스트 파일 내용 가져오기
 * @param {Object} job - 작업 객체 (getSummaryJob으로 받은 것)
 * @returns {Promise<string>} 화자 구분 텍스트
 */
async function getSpeakerTranscript(job) {
    // job.source_materials[0].output_artifacts.speaker_attributed_text_path에서 경로 가져오기
    if (!job.source_materials || job.source_materials.length === 0) {
        throw new Error('소스 자료가 없습니다.');
    }
    
    const material = job.source_materials[0];
    const artifacts = material.output_artifacts;
    
    if (!artifacts || !artifacts.speaker_attributed_text_path) {
        throw new Error('화자 구분 텍스트 파일이 생성되지 않았습니다.');
    }
    
    // 파일 경로를 다운로드 URL로 변환 (서버에 별도 엔드포인트 필요)
    // 현재는 파일 시스템 경로만 있으므로, 백엔드에 파일 다운로드 API 추가 필요
    throw new Error('화자 구분 텍스트 다운로드 API가 아직 구현되지 않았습니다.');
}

// ==== 오디오 파일 URL 가져오기 ====

/**
 * 업로드된 오디오 파일 URL 가져오기 (재생용)
 * @param {Object} job - 작업 객체
 * @returns {string|null} 오디오 파일 URL (현재는 로컬 경로만 반환)
 */
function getAudioFileUrl(job) {
    if (!job.source_materials || job.source_materials.length === 0) {
        return null;
    }
    
    const material = job.source_materials[0];
    // storage_path는 서버의 로컬 경로
    // 실제로 사용하려면 백엔드에 파일 서빙 엔드포인트 추가 필요
    // 예: GET /summary-jobs/{job_id}/audio
    return material.storage_path; // 현재는 로컬 경로만 반환
}

// ==== 내보내기 ====
// 브라우저 환경에서 전역 객체로 사용
const API = {
    // Workspace
    createWorkspace,
    getWorkspaces,
    
    // Subject
    createSubject,
    getSubjects,
    deleteSubject,
    
    // Summary Job
    createSummaryJob,
    getSummaryJobs,
    getSummaryJob,
    downloadSummary,
    deleteSummaryJob,
    
    // 유틸리티
    pollJobStatus,
    getSpeakerTranscript,
    getAudioFileUrl,
};

// Node.js 환경 대응
if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
}

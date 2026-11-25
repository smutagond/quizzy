"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";

type Question = {
  prompt: string;
  options: string[];
  correctIndex: number;
  seconds: number;
  imageUrl?: string;
};

type QuizStatus = "Live" | "Waiting" | "Ready" | "Draft" | "Completed";

type Quiz = {
  id: string;
  title: string;
  description?: string;
  code: string;
  hostToken?: string;
  status: QuizStatus;
  questions: Question[];
  participants: number;
  date: string;
};

type HostParticipant = {
  id: string;
  name: string;
  score: number;
  correctAnswers: number;
  answeredCount: number;
  totalResponseMs: number;
  connected: boolean;
  answeredCurrent: boolean;
  lastAnswerCorrect?: boolean;
  lastAnswerPoints?: number;
};

type HostSession = {
  code: string;
  title: string;
  status: "waiting" | "starting" | "live" | "ended";
  phase?: "countdown" | "question" | "reveal";
  countdownEndsAt?: number | null;
  locked: boolean;
  participants: HostParticipant[];
  questionCount: number;
  questionIndex: number;
  question: Question | null;
  questionStartedAt: number | null;
  questionEndsAt: number | null;
  serverNow: number;
  optionVotes?: number[];
  optionPercentages?: number[];
  totalVotes?: number;
};

export type AdminTab = "overview" | "quizzes" | "create" | "host" | "settings";

export type ParticipantLeaderboardItem = {
  id: string;
  name: string;
  score: number;
  correctAnswers: number;
  answeredCurrent: boolean;
  connected: boolean;
  totalResponseMs?: number;
  lastAnswerCorrect?: boolean;
  lastAnswerPoints?: number;
};

type PlayerSession = {
  code: string;
  title: string;
  status: "waiting" | "starting" | "live" | "ended";
  phase?: "countdown" | "question" | "reveal";
  countdownEndsAt?: number | null;
  locked: boolean;
  participantName: string;
  participantId: string;
  score: number;
  correctAnswers: number;
  participantCount: number;
  questionCount: number;
  questionIndex: number;
  question: Pick<Question, "prompt" | "options" | "seconds" | "imageUrl"> | null;
  correctIndex?: number;
  questionStartedAt: number | null;
  questionEndsAt: number | null;
  answered: boolean;
  selectedOption?: number;
  isCorrect?: boolean;
  pointsEarned?: number;
  leaderboard?: ParticipantLeaderboardItem[];
  serverNow: number;
  optionVotes?: number[];
  optionPercentages?: number[];
  totalVotes?: number;
};

type IconName =
  | "arrow"
  | "book"
  | "chart"
  | "check"
  | "chevron"
  | "clock"
  | "copy"
  | "crown"
  | "edit"
  | "globe"
  | "image"
  | "layout"
  | "lightning"
  | "lock"
  | "menu"
  | "play"
  | "plus"
  | "refresh"
  | "settings"
  | "sparkles"
  | "trophy"
  | "trash"
  | "users";

const SAVED_QUIZZES_KEY = "quizz-created-quizzes";
const DELETED_QUIZZES_KEY = "quizz-deleted-quizzes";
const HOST_SETTINGS_KEY = "quizz-host-settings";
const QUIZ_HISTORY_KEY = "quizz-history-records";
const DUMMY_QUIZ_IDS = new Set(["q-design", "q-product", "q-onboarding"]);
const STORAGE_UNAVAILABLE = "__storage_unavailable__";

export type QuizHistoryItem = {
  id: string;
  quizId?: string;
  title: string;
  code: string;
  date: string;
  timestamp: number;
  participants: number;
  topScore?: { name: string; score: number };
  questionsCount?: number;
};

function subscribeToSavedQuizzes(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("quizz-storage", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("quizz-storage", onStoreChange);
  };
}

function getSavedQuizSnapshot() {
  try {
    return window.localStorage.getItem(SAVED_QUIZZES_KEY) ?? "[]";
  } catch {
    return STORAGE_UNAVAILABLE;
  }
}

function getDeletedQuizSnapshot() {
  try {
    return window.localStorage.getItem(DELETED_QUIZZES_KEY) ?? "[]";
  } catch {
    return STORAGE_UNAVAILABLE;
  }
}

function getServerSavedQuizSnapshot() {
  return "[]";
}

function isQuiz(value: unknown): value is Quiz {
  if (!value || typeof value !== "object") return false;
  const quiz = value as Partial<Quiz>;
  return typeof quiz.id === "string"
    && typeof quiz.title === "string"
    && typeof quiz.code === "string"
    && (quiz.description === undefined || typeof quiz.description === "string")
    && (quiz.hostToken === undefined || typeof quiz.hostToken === "string")
    && Array.isArray(quiz.questions)
    && quiz.questions.every((question) => {
      if (!question || typeof question !== "object") return false;
      const candidate = question as Question;
      return typeof candidate.prompt === "string"
        && Array.isArray(candidate.options)
        && candidate.options.length === 4
        && candidate.options.every((option) => typeof option === "string")
        && Number.isInteger(candidate.correctIndex)
        && typeof candidate.seconds === "number"
        && (candidate.imageUrl === undefined || typeof candidate.imageUrl === "string");
    })
    && (quiz.status === "Live" || quiz.status === "Waiting" || quiz.status === "Ready" || quiz.status === "Draft" || quiz.status === "Completed");
}

const iconPaths: Record<IconName, ReactNode> = {
  arrow: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z" /><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20" /></>,
  chart: <><path d="M4 19V5" /><path d="M4 19h17" /><path d="m7 15 4-4 3 2 5-6" /><path d="M16 7h3v3" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  crown: <><path d="m2 8 5 4 5-8 5 8 5-4-2 12H4z" /><path d="M4 17h16" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18" /><path d="M12 3a15 15 0 0 0 0 18" /></>,
  image: <><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></>,
  layout: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 3v18" /><path d="M9 9h12" /></>,
  lightning: <path d="m13 2-3 8h7l-6 12 2-9H6z" />,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  play: <path d="m8 5 12 7-12 7z" />,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  refresh: <><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21h5v-5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  sparkles: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z" /><path d="m19 14 1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1z" /></>,
  trophy: <><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4v2a4 4 0 0 0 4 4" /><path d="M17 6h3v2a4 4 0 0 1-4 4" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /><path d="M10 11v5" /><path d="M14 11v5" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></>,
};

function Icon({ name, size = 18, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  );
}

const IOT_WARMUP_QUESTIONS: Question[] = [
  {
    prompt: 'What does "IoT" stand for?',
    options: ["Internet of Tools", "Internet of Things", "Interface of Technology", "Input over Transmission"],
    correctIndex: 1,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "Which component converts a physical condition (like heat or light) into an electrical signal?",
    options: ["Actuator", "Relay", "Sensor", "Buzzer"],
    correctIndex: 2,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1555664424-778a1e5e1b48?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "Twist Check: You build a smart room system where a DHT11 sensor checks heat, an ESP32 decides what to do, and a fan turns on. Which part is the input?",
    options: ["Fan", "DHT11", "ESP32", "Wi-Fi router"],
    correctIndex: 1,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1558002038-1055907df827?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "Which sensor is specifically used in our workshop to measure room temperature and humidity?",
    options: ["MQ-2", "PIR", "DHT11", "Ultrasonic"],
    correctIndex: 2,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1563861826100-9cb868fdbe1c?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "What is the main difference between a traditional device and a smart connected device?",
    options: [
      "Traditional devices never use electricity",
      "Smart devices can sense, decide/report, and connect rather than just waiting for manual action",
      "Traditional devices always have Wi-Fi",
      "Smart devices cannot use sensors",
    ],
    correctIndex: 1,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: 'Which of the following is an actuator (the "muscle" of IoT)?',
    options: ["LDR", "DHT11", "Relay", "MQ-2"],
    correctIndex: 2,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "Which microcontroller in our workshop has built-in Wi-Fi and Bluetooth at low cost?",
    options: ["ESP32", "Breadboard", "Jumper wire", "Resistor"],
    correctIndex: 0,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1517077304055-6e89abbf09b0?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "In the 5-step IoT workflow (Sense → Process → Connect → Display → Act), what is Step 1?",
    options: ["Act", "Connect", "Sense", "Display"],
    correctIndex: 2,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "Twist Check: A street lamp turns on automatically when darkness falls. Which sensor is most likely spotting the drop in brightness?",
    options: ["PIR sensor", "LDR (Light sensor)", "DHT11", "Relay"],
    correctIndex: 1,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1509114397022-ed747cca3f65?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "Which sensor uses sound waves to measure how far an object is?",
    options: ["Ultrasonic sensor", "IR sensor", "MQ-2 gas sensor", "DHT11"],
    correctIndex: 0,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "What does a relay help do in an IoT circuit?",
    options: [
      "Measure air humidity",
      "Safely switch higher-voltage AC appliances",
      "Replace the internet",
      "Store video files",
    ],
    correctIndex: 1,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1544724569-5f546fd6f2b5?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "Which layer of basic IoT architecture sits right at the bottom with sensors and devices?",
    options: ["Application Layer", "Cloud Layer", "Sensor / Device Layer", "Network Layer"],
    correctIndex: 2,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "Twist Check: A smartwatch counts your steps and heart rate and shows them on your phone. Which two IoT application areas does this touch?",
    options: [
      "Smart cities & mining",
      "Wearables/Healthcare & everyday smart tech",
      "Agriculture & heavy shipping",
      "Aerospace & oil rigs",
    ],
    correctIndex: 1,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "In our live demo preview, how does the ESP32 get temperature and humidity data?",
    options: [
      "By guessing from the room size",
      "By reading it from the wired DHT11 sensor",
      "By downloading it from a weather satellite only",
      "Using a buzzer",
    ],
    correctIndex: 1,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1581092335397-9583fe92d232?w=800&auto=format&fit=crop&q=80",
  },
  {
    prompt: "Which wireless technology is specifically noted as an ultra-low-power link for smartwatches and beacons?",
    options: ["BLE (Bluetooth Low Energy)", "HDMI", "VGA", "Ethernet cable only"],
    correctIndex: 0,
    seconds: 20,
    imageUrl: "https://images.unsplash.com/photo-1579567761406-4684ee0c75b6?w=800&auto=format&fit=crop&q=80",
  },
];

const INITIAL_QUIZZES: Quiz[] = [
  {
    id: "quiz-iot-warmup",
    title: "Quiz 1: IoT Warm-Up (Easy + Light Twists)",
    description: "Best right after covering IoT Basics, Workflow, and Core Hardware.",
    code: "482190",
    status: "Ready",
    questions: IOT_WARMUP_QUESTIONS,
    participants: 0,
    date: "Just now",
  },
];

function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`brand${light ? " brand-light" : ""}`}>
      <span className="brand-mark"><Icon name="sparkles" size={19} strokeWidth={2.2} /></span>
      <span>quizz<span className="brand-period">.</span></span>
    </span>
  );
}

function makeQuestion(seconds = 20): Question {
  return {
    prompt: "",
    options: ["", "", "", ""],
    correctIndex: 0,
    seconds,
    imageUrl: "",
  };
}

type HostSettings = {
  defaultSeconds: number;
  speedBonusEnabled: boolean;
  autoAdvance: boolean;
  autoLockOnStart: boolean;
  showLeaderboardToPlayers: boolean;
  soundEffects: boolean;
};

const DEFAULT_SETTINGS: HostSettings = {
  defaultSeconds: 20,
  speedBonusEnabled: true,
  autoAdvance: false,
  autoLockOnStart: true,
  showLeaderboardToPlayers: true,
  soundEffects: true,
};

function makeSecureToken() {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeUniqueQuizCode(reservedCodes: string[]) {
  const reserved = new Set(reservedCodes);
  for (let attempt = 0; attempt < 900000; attempt += 1) {
    const random = new Uint32Array(1);
    window.crypto.getRandomValues(random);
    const code = String(100000 + (random[0] % 900000));
    if (!reserved.has(code)) return code;
  }
  throw new Error("No unused quiz codes are available.");
}

type PodiumParticipant = {
  id: string;
  name: string;
  score: number;
  correctAnswers?: number;
};

function WinnersPodium({
  participants,
  currentUserId,
  title = "Final Quiz Results",
  subtitle = "Congratulations to our top performers and all participants!",
  onPrimaryAction,
  primaryActionLabel,
  onSecondaryAction,
  secondaryActionLabel,
}: {
  participants: PodiumParticipant[];
  currentUserId?: string;
  title?: string;
  subtitle?: string;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  onSecondaryAction?: () => void;
  secondaryActionLabel?: string;
}) {
  const sorted = [...participants].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const top1 = sorted[0];
  const top2 = sorted[1];
  const top3 = sorted[2];
  const remaining = sorted.slice(3);

  const podiumSlots = [
    { rank: 2, participant: top2, badge: "2nd Place", prize: "🥈 2nd Prize · Silver Medal of Excellence", cardClass: "podium-card-2", icon: "🥈", hasCrown: false },
    { rank: 1, participant: top1, badge: "1st Place Champion", prize: "🥇 1st Prize · Gold Champion Trophy & Certificate", cardClass: "podium-card-1", icon: "🏆", hasCrown: true },
    { rank: 3, participant: top3, badge: "3rd Place", prize: "🥉 3rd Prize · Bronze Medalist Award", cardClass: "podium-card-3", icon: "🥉", hasCrown: false },
  ];

  return (
    <div className="winners-podium">
      <div className="podium-intro">
        <span className="section-kicker">OFFICIAL STANDINGS & PRIZES</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>

      {sorted.length > 0 ? (
        <>
          <div className="podium-cards-grid">
            {podiumSlots.map(({ participant, badge, prize, cardClass, icon, hasCrown }) => {
              if (!participant) return null;
              const isCurrent = Boolean(currentUserId && participant.id === currentUserId);
              return (
                <div key={participant.id} className={`podium-card ${cardClass}${isCurrent ? " is-current-player" : ""}`}>
                  {hasCrown && <span className="podium-crown" role="img" aria-label="Crown">👑</span>}
                  <span className="podium-badge">{badge}</span>
                  <div className="podium-icon" style={{ fontSize: "24px" }}>
                    {icon}
                  </div>
                  <strong className="podium-name" title={participant.name}>
                    {participant.name}
                    {isCurrent && <span className="you-pill">You</span>}
                  </strong>
                  <div className="podium-score">
                    {participant.score.toLocaleString()} <span>pts</span>
                  </div>
                  <div className="podium-prize" title={prize}>
                    {prize}
                  </div>
                  <span className="podium-correct">
                    {participant.correctAnswers ?? 0} correct answers
                  </span>
                </div>
              );
            })}
          </div>

          {remaining.length > 0 && (
            <div className="remaining-section">
              <div className="remaining-header">
                <h3>All Remaining Participants</h3>
                <span className="participant-count-pill">
                  <Icon name="users" size={12} /> {remaining.length} players
                </span>
              </div>
              <div className="remaining-list">
                {remaining.map((item, idx) => {
                  const rank = idx + 4;
                  const isCurrent = Boolean(currentUserId && item.id === currentUserId);
                  return (
                    <div key={item.id} className={`remaining-row${isCurrent ? " is-current-player" : ""}`}>
                      <span className="remaining-rank">#{rank}</span>
                      <span className="remaining-avatar">{item.name.trim()[0]?.toUpperCase() ?? "?"}</span>
                      <div className="remaining-name">
                        <strong>
                          {item.name}
                          {isCurrent && <span className="you-pill">You</span>}
                        </strong>
                        <small>{item.correctAnswers ?? 0} correct answers</small>
                      </div>
                      <strong className="remaining-score">{item.score.toLocaleString()} pts</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="leaderboard-empty">
          <span className="empty-people"><Icon name="users" size={21} /></span>
          <strong>No participant scores available</strong>
          <p>Participants who join and play will be awarded ranks and prizes here.</p>
        </div>
      )}

      {(onPrimaryAction || onSecondaryAction) && (
        <div className="podium-actions">
          {onPrimaryAction && (
            <button type="button" className="button button-dark" onClick={onPrimaryAction}>
              {primaryActionLabel ?? "Continue"} <Icon name="arrow" size={15} />
            </button>
          )}
          {onSecondaryAction && (
            <button type="button" className="button button-soft" onClick={onSecondaryAction}>
              {secondaryActionLabel ?? "Back"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function QuizApp() {
  const [view, setView] = useState<"home" | "admin" | "waiting" | "countdown" | "play" | "results">("home");
  const [adminTab, setAdminTab] = useState<"overview" | "quizzes" | "create" | "host" | "settings">("overview");
  const [joinStep, setJoinStep] = useState<"code" | "name">("code");
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [joinError, setJoinError] = useState("");
  const [serviceConnected, setServiceConnected] = useState(false);
  const [hostSettings, setHostSettings] = useState<HostSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    try {
      const raw = window.localStorage.getItem(HOST_SETTINGS_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
      return DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const updateHostSettings = (patch: Partial<HostSettings>) => {
    setHostSettings((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(HOST_SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable
      }
      return next;
    });
  };
  const savedQuizSnapshot = useSyncExternalStore(subscribeToSavedQuizzes, getSavedQuizSnapshot, getServerSavedQuizSnapshot);
  const deletedQuizSnapshot = useSyncExternalStore(subscribeToSavedQuizzes, getDeletedQuizSnapshot, getServerSavedQuizSnapshot);
  const savedQuizzes = useMemo(() => {
    if (savedQuizSnapshot === STORAGE_UNAVAILABLE) return [];
    try {
      const parsed: unknown = JSON.parse(savedQuizSnapshot);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is Quiz => isQuiz(item) && !DUMMY_QUIZ_IDS.has(item.id))
        : [];
    } catch {
      return [];
    }
  }, [savedQuizSnapshot]);
  const deletedQuizIds = useMemo(() => {
    if (deletedQuizSnapshot === STORAGE_UNAVAILABLE) return [];
    try {
      const parsed: unknown = JSON.parse(deletedQuizSnapshot);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  }, [deletedQuizSnapshot]);
  const [sessionQuizzes, setSessionQuizzes] = useState<Quiz[]>([]);
  const [sessionDeletedQuizIds, setSessionDeletedQuizIds] = useState<string[]>([]);
  const quizzes = useMemo(() => {
    const records = new Map<string, Quiz>();
    for (const quiz of [...INITIAL_QUIZZES, ...savedQuizzes, ...sessionQuizzes]) records.set(quiz.id, quiz);
    const deletedIds = new Set([...deletedQuizIds, ...sessionDeletedQuizIds]);
    return [...records.values()].filter((quiz) => !deletedIds.has(quiz.id));
  }, [deletedQuizIds, savedQuizzes, sessionDeletedQuizIds, sessionQuizzes]);
  const [quizTitle, setQuizTitle] = useState("");
  const [quizDescription, setQuizDescription] = useState("");
  const [draftQuestions, setDraftQuestions] = useState<Question[]>([makeQuestion()]);
  const [editingQuizId, setEditingQuizId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [quizToDelete, setQuizToDelete] = useState<Quiz | null>(null);
  const [dataResetDialog, setDataResetDialog] = useState<"all" | "history" | "everything" | null>(null);
  const [historyRecords, setHistoryRecords] = useState<QuizHistoryItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(QUIZ_HISTORY_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as QuizHistoryItem[]) : [];
    } catch {
      return [];
    }
  });
  const recordSessionHistoryRef = useRef<(quiz: Quiz, participantsCount: number, topPlayer?: { name: string; score: number }) => void>(() => {});

  const recordSessionHistory = (quiz: Quiz, participantsCount: number, topPlayer?: { name: string; score: number }) => {
    const newRecord: QuizHistoryItem = {
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      quizId: quiz.id,
      title: quiz.title,
      code: quiz.code,
      date: new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      timestamp: Date.now(),
      participants: participantsCount,
      topScore: topPlayer,
      questionsCount: quiz.questions?.length ?? 0,
    };
    setHistoryRecords((prev) => {
      const filtered = prev.filter((r) => !(r.code === quiz.code && Math.abs(r.timestamp - newRecord.timestamp) < 5000));
      const updated = [newRecord, ...filtered].slice(0, 50);
      try {
        window.localStorage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  useEffect(() => {
    recordSessionHistoryRef.current = recordSessionHistory;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SAVED_QUIZZES_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter((item): item is Quiz => isQuiz(item) && !DUMMY_QUIZ_IDS.has(item.id));
          if (cleaned.length !== parsed.length) {
            window.localStorage.setItem(SAVED_QUIZZES_KEY, JSON.stringify(cleaned));
            window.dispatchEvent(new Event("quizz-storage"));
          }
        }
      }
    } catch {}
  }, []);

  const [hostAuthQuiz, setHostAuthQuiz] = useState<Quiz | null>(null);
  const [hostPasswordInput, setHostPasswordInput] = useState("");
  const [hostPasswordError, setHostPasswordError] = useState("");
  const [showHostPassword, setShowHostPassword] = useState(false);
  const [isHostUnlocked, setIsHostUnlocked] = useState(true);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(true);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminTargetTab, setAdminTargetTab] = useState<AdminTab>("overview");
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [adminPasswordError, setAdminPasswordError] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [createdCode, setCreatedCode] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [hostSession, setHostSession] = useState<HostSession | null>(null);
  const [playerSession, setPlayerSession] = useState<PlayerSession | null>(null);
  const [activeHostQuiz, setActiveHostQuiz] = useState<Quiz | null>(null);
  const [activeHostToken, setActiveHostToken] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [serverOffset, setServerOffset] = useState(0);
  const [clockNow, setClockNow] = useState(0);
  const [hostSidebarOpen, setHostSidebarOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const playerQuestionRef = useRef(-1);
  const activeHostQuizRef = useRef<Quiz | null>(null);
  const storeQuizRecordRef = useRef<(quiz: Quiz) => boolean>(() => false);

  const storeQuizRecord = (quiz: Quiz) => {
    const nextQuizzes = [quiz, ...savedQuizzes.filter((saved) => saved.id !== quiz.id)];
    try {
      window.localStorage.setItem(SAVED_QUIZZES_KEY, JSON.stringify(nextQuizzes));
      window.dispatchEvent(new Event("quizz-storage"));
      return true;
    } catch {
      setSessionQuizzes((current) => [quiz, ...current.filter((saved) => saved.id !== quiz.id)]);
      return false;
    }
  };

  const getQuizStatus = useCallback((quiz: Quiz): QuizStatus => {
    if (activeHostQuiz?.id === quiz.id && hostSession) {
      if (hostSession.status === "waiting") return "Waiting";
      if (hostSession.status === "live") return "Live";
      if (hostSession.status === "ended") return "Completed";
    }
    if (quiz.status === "Waiting" || quiz.status === "Live") {
      return quiz.participants > 0 ? "Completed" : "Ready";
    }
    if (quiz.participants > 0) {
      return "Completed";
    }
    if (quiz.status === "Draft" && quiz.questions?.length > 0) {
      return "Ready";
    }
    return quiz.status;
  }, [activeHostQuiz?.id, hostSession]);

  const totalParticipantsCount = useMemo(() => {
    const fromQuizzes = quizzes.reduce((acc, q) => acc + (q.participants || 0), 0);
    const fromHistory = historyRecords.reduce((acc, h) => acc + (h.participants || 0), 0);
    return Math.max(fromQuizzes, fromHistory);
  }, [quizzes, historyRecords]);

  const completedSessionsCount = useMemo(() => {
    const completedInQuizzes = quizzes.filter((q) => getQuizStatus(q) === "Completed").length;
    return Math.max(completedInQuizzes, historyRecords.length);
  }, [quizzes, historyRecords, getQuizStatus]);

  const handleDeleteAllQuizData = () => {
    const socket = socketRef.current;
    if (socket?.connected && activeHostQuiz && activeHostToken) {
      socket.emit("host:end", { code: activeHostQuiz.code, hostToken: activeHostToken });
    }
    try {
      window.localStorage.removeItem(SAVED_QUIZZES_KEY);
      window.localStorage.removeItem(DELETED_QUIZZES_KEY);
    } catch {}
    setSessionQuizzes([]);
    setSessionDeletedQuizIds([]);
    setActiveHostQuiz(null);
    setHostSession(null);
    setCreatedCode("");
    setDataResetDialog(null);
    window.dispatchEvent(new Event("quizz-storage"));
    setToast("All quiz data has been deleted. Workspace is fresh.");
  };

  const handleClearHistory = () => {
    try {
      window.localStorage.removeItem(QUIZ_HISTORY_KEY);
    } catch {}
    setHistoryRecords([]);
    setDataResetDialog(null);
    setToast("Trial session history has been cleared.");
  };

  const handleResetEverything = () => {
    const socket = socketRef.current;
    if (socket?.connected && activeHostQuiz && activeHostToken) {
      socket.emit("host:end", { code: activeHostQuiz.code, hostToken: activeHostToken });
    }
    try {
      window.localStorage.removeItem(SAVED_QUIZZES_KEY);
      window.localStorage.removeItem(DELETED_QUIZZES_KEY);
      window.localStorage.removeItem(QUIZ_HISTORY_KEY);
    } catch {}
    setSessionQuizzes([]);
    setSessionDeletedQuizIds([]);
    setHistoryRecords([]);
    setActiveHostQuiz(null);
    setHostSession(null);
    setCreatedCode("");
    setDataResetDialog(null);
    window.dispatchEvent(new Event("quizz-storage"));
    setToast("All quizzes, history records, and workspace data reset.");
  };

  useEffect(() => {
    storeQuizRecordRef.current = storeQuizRecord;
  });

  useEffect(() => {
    if (!quizToDelete && !dataResetDialog) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setQuizToDelete(null);
        setDataResetDialog(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [quizToDelete, dataResetDialog]);

  useEffect(() => {
    const targetUrl = process.env.NEXT_PUBLIC_REALTIME_URL
      || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

    const socket = io(targetUrl, {
      path: "/socket.io",
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: 100,
      reconnectionDelay: 1000,
      timeout: 20000,
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      console.log("Realtime socket connected successfully:", socket.id);
      setServiceConnected(true);
      const activeQuiz = activeHostQuizRef.current;
      if (activeQuiz?.code && activeQuiz?.hostToken) {
        socket.emit("host:claim", {
          code: activeQuiz.code,
          hostToken: activeQuiz.hostToken,
        }, (res?: { ok: boolean }) => {
          if (!res?.ok) {
            socket.emit("host:create", {
              code: activeQuiz.code,
              title: activeQuiz.title,
              questions: activeQuiz.questions,
              hostToken: activeQuiz.hostToken,
              reservedCodes: [],
            });
          }
        });
      }
    });
    socket.on("connect_error", (err) => {
      console.warn("Realtime socket connect_error:", err.message);
    });
    socket.on("disconnect", (reason) => {
      console.warn("Realtime socket disconnected:", reason);
      setServiceConnected(false);
    });
    socket.on("host:state", (state: HostSession) => {
      if (activeHostQuizRef.current && state.code !== activeHostQuizRef.current.code) return;
      setHostSession(state);
      setClockNow(Date.now());
      setServerOffset(state.serverNow - Date.now());
      const currentQuiz = activeHostQuizRef.current;
      if (currentQuiz?.code === state.code) {
        if (state.status === "ended") {
          const sorted = state.participants ? [...state.participants].sort((a, b) => b.score - a.score) : [];
          const topPlayer = sorted[0] ? { name: sorted[0].name, score: sorted[0].score } : undefined;
          recordSessionHistoryRef.current(currentQuiz, state.participants.length, topPlayer);
        }
        const updatedQuiz = {
          ...currentQuiz,
          status: state.status === "waiting" || state.status === "starting" ? "Waiting" as const : state.status === "live" ? "Live" as const : "Completed" as const,
          participants: state.participants.length,
        };
        activeHostQuizRef.current = updatedQuiz;
        setActiveHostQuiz(updatedQuiz);
        storeQuizRecordRef.current(updatedQuiz);
      }
    });
    socket.on("participant:state", (state: PlayerSession) => {
      setPlayerSession(state);
      setClockNow(Date.now());
      setServerOffset(state.serverNow - Date.now());
      setFullName(state.participantName);
      setParticipantId(state.participantId);
      if (state.questionIndex !== playerQuestionRef.current) {
        playerQuestionRef.current = state.questionIndex;
        setSelectedOption(null);
      }
      setView(
        state.status === "waiting"
          ? "waiting"
          : state.status === "starting" || state.phase === "countdown"
            ? "countdown"
            : state.status === "live"
              ? "play"
              : "results",
      );
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (view !== "play" && view !== "countdown" && !(view === "admin" && adminTab === "host")) return;
    const timerId = window.setInterval(() => setClockNow(Date.now()), 100);
    return () => window.clearInterval(timerId);
  }, [adminTab, view]);

  useEffect(() => {
    if (!hostSidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHostSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hostSidebarOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast("");
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const navigateToAdmin = (targetTab: AdminTab = "overview") => {
    setView("admin");
    setAdminTab(targetTab);
  };

  const submitAdminLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const response = await fetch("/api/admin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPasswordInput }),
      });
      const data = await response.json();
      if (data.ok) {
        setIsAdminAuthenticated(true);
        try {
          window.sessionStorage.setItem("quizze_admin_auth", "true");
        } catch {}
        setAdminLoginOpen(false);
        setAdminPasswordInput("");
        setAdminPasswordError("");
        setView("admin");
        setAdminTab(adminTargetTab);
        setToast("Welcome to host workspace, Suraj M!");
      } else {
        setAdminPasswordError("Incorrect admin password. Please try again.");
      }
    } catch {
      setAdminPasswordError("Unable to verify password right now. Please try again.");
    }
  };

  const logoutAdmin = () => {
    setIsAdminAuthenticated(false);
    try {
      window.sessionStorage.removeItem("quizze_admin_auth");
    } catch {}
    setView("home");
    setToast("Logged out of host workspace.");
  };

  const countdownSecondsLeft = (playerSession?.countdownEndsAt || hostSession?.countdownEndsAt)
    ? Math.max(0, Math.ceil(((playerSession?.countdownEndsAt || hostSession?.countdownEndsAt)! - (clockNow + serverOffset)) / 1000))
    : 0;
  const playerSecondsLeft = playerSession?.questionEndsAt
    ? Math.max(0, Math.ceil((playerSession.questionEndsAt - (clockNow + serverOffset)) / 1000))
    : 0;
  const hostSecondsLeft = hostSession?.questionEndsAt
    ? Math.max(0, Math.ceil((hostSession.questionEndsAt - (clockNow + serverOffset)) / 1000))
    : 0;
  const isQuestionRevealed = Boolean(hostSession?.phase === "reveal" || hostSession?.status === "ended" || (hostSession?.status === "live" && hostSecondsLeft === 0));
  const isPlayerRevealed = Boolean(playerSession?.phase === "reveal" || (playerSession?.status === "live" && playerSecondsLeft === 0));
  const hasActiveQuiz = Boolean(hostSession && (hostSession.status === "waiting" || hostSession.status === "starting" || hostSession.status === "live"));
  const showLiveHostTab = hasActiveQuiz || (adminTab === "host" && Boolean(hostSession));

  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setJoinError("Enter the 6-digit code shared by your host.");
      return;
    }
    const socket = socketRef.current;
    if (!socket?.connected) {
      setJoinError("Connecting to live quiz service... please try again in a few seconds.");
      socket?.connect();
      return;
    }
    socket.emit("session:check", code, (response: { ok: boolean; reason?: string; locked?: boolean; status?: string }) => {
      if (!response.ok) {
        setJoinError(response.reason === "ended"
          ? "This quiz has ended. Please contact the host."
          : "This quiz hasn’t started yet. Please contact the host.");
        return;
      }
      if (response.status === "live") {
        setJoinError("This quiz is currently in progress. Please contact the host.");
        return;
      }
      if (response.locked) {
        setJoinError("The host has locked this waiting room. Please contact the host if you need to join.");
        return;
      }
      setJoinError("");
      setJoinStep("name");
    });
  };

  const submitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (fullName.trim().length < 2) {
      setJoinError("Please enter your full name to join.");
      return;
    }
    const socket = socketRef.current;
    if (!socket?.connected) {
      setJoinError("The connection was lost. Please try joining again.");
      return;
    }
    const id = makeSecureToken();
    setJoinError("");
    socket.emit("participant:join", { code, name: fullName.trim(), participantId: id }, (response: { ok: boolean; reason?: string }) => {
      if (!response.ok) {
        setJoinError(response.reason === "locked"
          ? "The host has locked this quiz. Please contact the host."
          : response.reason === "ended"
            ? "This quiz has ended. Please contact the host."
            : "This quiz hasn’t started yet. Please contact the host.");
        return;
      }
      setParticipantId(id);
      setView("waiting");
    });
  };

  const updateQuestion = (index: number, patch: Partial<Question>) => {
    setDraftQuestions((current) => current.map((question, questionIndex) =>
      questionIndex === index ? { ...question, ...patch } : question,
    ));
  };

  const saveQuiz = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!quizTitle.trim()) {
      setToast("Add a title to your quiz first.");
      return;
    }
    const validQuestions = draftQuestions.filter(
      (question) => question.prompt.trim() && question.options.every((option) => option.trim()),
    );
    if (!validQuestions.length) {
      setToast("Add a question and fill in all four answer choices.");
      return;
    }

    if (editingQuizId) {
      const currentQuiz = quizzes.find((quiz) => quiz.id === editingQuizId);
      if (!currentQuiz) {
        setToast("This quiz is no longer available to edit.");
        return;
      }
      const updatedQuiz = {
        ...currentQuiz,
        title: quizTitle.trim(),
        description: quizDescription.trim(),
        questions: validQuestions,
        status: "Ready" as const,
        date: "Updated just now",
      };
      const savedSuccessfully = storeQuizRecord(updatedQuiz);
      setEditingQuizId(null);
      setQuizTitle("");
      setQuizDescription("");
      setDraftQuestions([makeQuestion()]);
      setAdminTab("quizzes");
      setToast(savedSuccessfully ? "Your quiz changes have been saved." : "Changes saved for this session only.");
      return;
    }

    const newCode = makeUniqueQuizCode(quizzes.map((quiz) => quiz.code));

    const newQuiz: Quiz = {
      id: `quiz-${Date.now()}`,
      title: quizTitle.trim(),
      description: quizDescription.trim(),
      code: newCode,
      hostToken: makeSecureToken(),
      status: "Ready",
      questions: validQuestions,
      participants: 0,
      date: "Just now",
    };
    setCreatedCode(newCode);
    const savedSuccessfully = storeQuizRecord(newQuiz);
    setQuizTitle("");
    setQuizDescription("");
    setDraftQuestions([makeQuestion()]);
    setAdminTab("overview");
    setToast(savedSuccessfully
      ? "Your quiz is ready to share."
      : "Quiz created for this session, but this browser couldn’t save it for next time.");
  };

  const editQuiz = (quiz: Quiz) => {
    const status = getQuizStatus(quiz);
    if (status === "Waiting" || status === "Live") {
      setToast("End the live room before editing this quiz.");
      return;
    }
    setEditingQuizId(quiz.id);
    setQuizTitle(quiz.title);
    setQuizDescription(quiz.description ?? "");
    setDraftQuestions(quiz.questions.map((question) => ({ ...question, options: [...question.options] })));
    setAdminTab("create");
  };

  const requestQuizDeletion = (quiz: Quiz) => {
    const status = getQuizStatus(quiz);
    if (status === "Waiting" || status === "Live") {
      setToast("End the live room before deleting this quiz.");
      return;
    }
    setQuizToDelete(quiz);
  };

  const confirmQuizDeletion = () => {
    if (!quizToDelete) return;
    const quiz = quizzes.find((item) => item.id === quizToDelete.id);
    if (!quiz) {
      setQuizToDelete(null);
      setToast("This quiz has already been deleted.");
      return;
    }
    const status = getQuizStatus(quiz);
    if (status === "Waiting" || status === "Live") {
      setQuizToDelete(null);
      setToast("End the live room before deleting this quiz.");
      return;
    }

    let deletionMarkerSaved = false;
    let savedQuizDataRemoved = false;
    try {
      const rawDeletedIds = window.localStorage.getItem(DELETED_QUIZZES_KEY) ?? "[]";
      const parsedDeletedIds: unknown = JSON.parse(rawDeletedIds);
      const existingDeletedIds = Array.isArray(parsedDeletedIds)
        ? parsedDeletedIds.filter((id): id is string => typeof id === "string")
        : [];
      window.localStorage.setItem(DELETED_QUIZZES_KEY, JSON.stringify([...new Set([...existingDeletedIds, quiz.id])]));
      deletionMarkerSaved = true;

      const rawSavedQuizzes = window.localStorage.getItem(SAVED_QUIZZES_KEY) ?? "[]";
      const parsedSavedQuizzes: unknown = JSON.parse(rawSavedQuizzes);
      const remainingQuizzes = Array.isArray(parsedSavedQuizzes)
        ? parsedSavedQuizzes.filter((item): item is Quiz => isQuiz(item) && item.id !== quiz.id)
        : [];
      window.localStorage.setItem(SAVED_QUIZZES_KEY, JSON.stringify(remainingQuizzes));
      savedQuizDataRemoved = true;
    } catch {
      if (!deletionMarkerSaved) {
        setToast("The browser couldn’t save this deletion. Please try again.");
        return;
      }
    }

    setSessionQuizzes((current) => current.filter((item) => item.id !== quiz.id));
    setSessionDeletedQuizIds((current) => current.includes(quiz.id) ? current : [...current, quiz.id]);
    window.dispatchEvent(new Event("quizz-storage"));
    setQuizToDelete(null);
    setToast(!deletionMarkerSaved
      ? "Quiz deleted for this session only; browser storage is unavailable."
      : savedQuizDataRemoved
        ? "Quiz deleted."
        : "Quiz removed from your list, but its saved details couldn’t be cleared.");
  };

  const requestHostQuiz = (quiz: Quiz) => {
    hostQuiz(quiz);
  };

  const submitHostAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hostAuthQuiz) return;
    try {
      const response = await fetch("/api/admin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: hostPasswordInput }),
      });
      const data = await response.json();
      if (data.ok) {
        setIsHostUnlocked(true);
        const target = hostAuthQuiz;
        setHostAuthQuiz(null);
        setHostPasswordInput("");
        setHostPasswordError("");
        setToast("Host password verified. Starting live quiz room...");
        hostQuiz(target);
      } else {
        setHostPasswordError("Incorrect host password. Please try again.");
      }
    } catch {
      setHostPasswordError("Unable to verify password right now. Please try again.");
    }
  };

  const hostQuiz = (quiz: Quiz) => {
    const hostedQuiz = { ...quiz, hostToken: quiz.hostToken ?? makeSecureToken(), status: "Waiting" as const };
    activeHostQuizRef.current = hostedQuiz;
    setActiveHostQuiz(hostedQuiz);
    setActiveHostToken(hostedQuiz.hostToken);
    setHostSession(null);
    setView("admin");
    setAdminTab("host");
    storeQuizRecord(hostedQuiz);
    const originalCode = hostedQuiz.code;

    const openRoom = (quizToHost: Quiz, attemptedCodes: string[], retriesLeft: number) => {
      const socket = socketRef.current;
      if (!socket) return;
      if (!socket.connected) {
        socket.connect();
        socket.once("connect", () => {
          openRoom(quizToHost, attemptedCodes, retriesLeft);
        });
        return;
      }
      socket.emit("host:create", {
        code: quizToHost.code,
        title: quizToHost.title,
        questions: quizToHost.questions,
        hostToken: quizToHost.hostToken,
        reservedCodes: [...quizzes.map((item) => item.code), ...attemptedCodes],
      }, (response: { ok: boolean; error?: string; code?: string }) => {
        if (!response.ok) {
          if (response.error === "This code is already being used by another host." && retriesLeft > 0) {
            const nextCode = makeUniqueQuizCode([...quizzes.map((item) => item.code), ...attemptedCodes]);
            const reassignedQuiz = { ...quizToHost, code: nextCode };
            activeHostQuizRef.current = reassignedQuiz;
            setActiveHostQuiz(reassignedQuiz);
            setCreatedCode(nextCode);
            storeQuizRecord(reassignedQuiz);
            openRoom(reassignedQuiz, [...attemptedCodes, nextCode], retriesLeft - 1);
            return;
          }
          setToast(response.error ?? "Couldn’t open this quiz room.");
          return;
        }

        const assignedCode = response.code ?? quizToHost.code;
        if (assignedCode !== quizToHost.code) {
          const reassignedQuiz = { ...quizToHost, code: assignedCode };
          activeHostQuizRef.current = reassignedQuiz;
          setActiveHostQuiz(reassignedQuiz);
          setCreatedCode(assignedCode);
          storeQuizRecord(reassignedQuiz);
        }
        setToast(assignedCode !== originalCode
          ? `That code was already in use, so we assigned ${assignedCode}. Share the new code with your students.`
          : `Waiting room is open. Share code ${assignedCode} with your students.`);
      });
    };

    openRoom(hostedQuiz, [hostedQuiz.code], 5);
  };

  const updateHostedQuiz = (event: "host:lock" | "host:start" | "host:next" | "host:end", values: Record<string, unknown> = {}) => {
    const socket = socketRef.current;
    if (!socket?.connected || !activeHostQuiz || !activeHostToken) {
      setToast("The host connection was lost. Reopen this quiz to reconnect.");
      return;
    }
    socket.emit(event, {
      code: activeHostQuiz.code,
      hostToken: activeHostToken,
      ...values,
    }, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) {
        setToast(response.error ?? "That host action couldn’t be completed.");
        return;
      }
      if (event === "host:start") {
        const updated = { ...activeHostQuiz, status: "Live" as const };
        activeHostQuizRef.current = updated;
        setActiveHostQuiz(updated);
        storeQuizRecord(updated);
      } else if (event === "host:end") {
        const participantsCount = hostSession?.participants.length ?? (activeHostQuiz?.participants || 0);
        const sorted = hostSession?.participants ? [...hostSession.participants].sort((a, b) => b.score - a.score) : [];
        const topPlayer = sorted[0] ? { name: sorted[0].name, score: sorted[0].score } : undefined;
        if (activeHostQuiz) {
          recordSessionHistory(activeHostQuiz, participantsCount, topPlayer);
        }
        const updated = { ...activeHostQuiz, status: "Completed" as const, participants: participantsCount };
        activeHostQuizRef.current = updated;
        setActiveHostQuiz(updated);
        storeQuizRecord(updated);
      }
    });
  };

  const endQuizRoom = (quiz: Quiz) => {
    const socket = socketRef.current;
    const token = quiz.hostToken || (activeHostQuiz?.id === quiz.id ? activeHostToken : "");
    if (socket?.connected && token) {
      socket.emit("host:end", { code: quiz.code, hostToken: token });
    }
    const participantsCount = (activeHostQuiz?.id === quiz.id && hostSession?.participants.length)
      ? hostSession.participants.length
      : quiz.participants;
    const sorted = (activeHostQuiz?.id === quiz.id && hostSession?.participants)
      ? [...hostSession.participants].sort((a, b) => b.score - a.score)
      : [];
    const topPlayer = sorted[0] ? { name: sorted[0].name, score: sorted[0].score } : undefined;
    recordSessionHistory(quiz, participantsCount, topPlayer);

    const updated: Quiz = { ...quiz, status: "Completed", participants: participantsCount };
    storeQuizRecord(updated);
    if (activeHostQuiz?.id === quiz.id) {
      const activeUpdated = { ...activeHostQuiz, status: "Completed" as const, participants: participantsCount };
      activeHostQuizRef.current = activeUpdated;
      setActiveHostQuiz(activeUpdated);
      setHostSession(null);
    }
    setToast(`Live session for "${quiz.title}" ended. Trial history recorded.`);
  };

  const refreshHostQuizCode = () => {
    if (!activeHostQuiz) return;
    if (hostSession?.status === "live") {
      setToast("Cannot change room code while a quiz is live.");
      return;
    }
    const newCode = makeUniqueQuizCode(quizzes.map((q) => q.code));
    const socket = socketRef.current;
    if (socket?.connected && activeHostToken) {
      socket.emit("host:change-code", {
        code: activeHostQuiz.code,
        hostToken: activeHostToken,
        newCode,
      }, (res: { ok: boolean; code?: string; error?: string }) => {
        if (!res.ok) {
          setToast(res.error ?? "Failed to change room code.");
          return;
        }
        const assigned = res.code || newCode;
        const updated = { ...activeHostQuiz, code: assigned };
        activeHostQuizRef.current = updated;
        setActiveHostQuiz(updated);
        setCreatedCode(assigned);
        storeQuizRecord(updated);
        setToast(`Quiz room code changed to ${assigned}!`);
      });
    } else {
      const updated = { ...activeHostQuiz, code: newCode };
      activeHostQuizRef.current = updated;
      setActiveHostQuiz(updated);
      setCreatedCode(newCode);
      storeQuizRecord(updated);
      setToast(`Quiz code updated to ${newCode}!`);
    }
  };

  const refreshQuizCode = (quiz: Quiz) => {
    const newCode = makeUniqueQuizCode(quizzes.map((q) => q.code));
    const token = quiz.hostToken || (activeHostQuiz?.id === quiz.id ? activeHostToken : "");
    const socket = socketRef.current;
    if (socket?.connected && token && (quiz.status === "Waiting" || activeHostQuiz?.id === quiz.id)) {
      socket.emit("host:change-code", {
        code: quiz.code,
        hostToken: token,
        newCode,
      });
    }
    const updated = { ...quiz, code: newCode };
    storeQuizRecord(updated);
    if (activeHostQuiz?.id === quiz.id) {
      activeHostQuizRef.current = updated;
      setActiveHostQuiz(updated);
    }
    if (createdCode === quiz.code) {
      setCreatedCode(newCode);
    }
    setToast(`New code for "${quiz.title}": ${newCode}`);
  };

  const refreshCreatedCode = () => {
    if (activeHostQuiz && activeHostQuiz.code === createdCode) {
      refreshHostQuizCode();
    } else {
      const newCode = makeUniqueQuizCode(quizzes.map((q) => q.code));
      setCreatedCode(newCode);
      setToast(`Generated new code: ${newCode}`);
    }
  };

  const submitPlayerAnswer = () => {
    const socket = socketRef.current;
    if (!socket?.connected || !playerSession || selectedOption === null) return;
    socket.emit("participant:answer", {
      code: playerSession.code,
      participantId,
      optionIndex: selectedOption,
    }, (response: { ok: boolean; error?: string; points?: number }) => {
      if (!response.ok) setToast(response.error ?? "Your answer couldn’t be submitted.");
    });
  };

  const copyCode = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setToast("Quiz code copied to clipboard.");
    } catch {
      setToast(`Your quiz code is ${value}.`);
    }
  };

  const closeToast = () => setToast("");
  const exitPlayerToHome = () => {
    if (playerSession && participantId) {
      socketRef.current?.emit("participant:leave", {
        code: playerSession.code,
        participantId,
      });
    }
    setView("home");
    setJoinStep("code");
    setCode("");
    setJoinError("");
    setSelectedOption(null);
    setPlayerSession(null);
  };

  return (
    <>
      {toast && (
        <div className="toast" role="status">
          <span className="toast-icon"><Icon name="check" size={16} /></span>
          <span>{toast}</span>
          <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={closeToast}>×</button>
        </div>
      )}

      {quizToDelete && (
        <div className="delete-dialog-backdrop" onClick={() => setQuizToDelete(null)}>
          <section
            className="delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="delete-dialog-icon"><Icon name="trash" size={20} /></span>
            <span className="section-kicker">DELETE QUIZ</span>
            <h2 id="delete-dialog-title">Delete “{quizToDelete.title}”?</h2>
            <p>This quiz will be removed from your list. This action can’t be undone.</p>
            <div className="delete-dialog-actions">
              <button type="button" className="button button-outline" autoFocus onClick={() => setQuizToDelete(null)}>Cancel</button>
              <button type="button" className="button button-danger" onClick={confirmQuizDeletion}><Icon name="trash" size={15} /> Delete quiz</button>
            </div>
          </section>
        </div>
      )}

      {dataResetDialog && (
        <div className="delete-dialog-backdrop" onClick={() => setDataResetDialog(null)}>
          <section
            className="delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="delete-dialog-icon"><Icon name="trash" size={20} /></span>
            <span className="section-kicker">DATA MANAGEMENT</span>
            <h2 id="data-dialog-title">
              {dataResetDialog === "all"
                ? "Delete all quiz data?"
                : dataResetDialog === "history"
                  ? "Clear trial session history?"
                  : "Reset entire workspace?"}
            </h2>
            <p>
              {dataResetDialog === "all"
                ? "This will permanently delete all created quizzes, questions, and drafts from this device. All trial session history is kept safe unless cleared separately."
                : dataResetDialog === "history"
                  ? "This will permanently delete all past quiz trial results, player leaderboards, and turnouts."
                  : "This will permanently remove all quizzes, session history, and workspace preferences."}
            </p>
            <div className="delete-dialog-actions">
              <button
                type="button"
                className="button button-outline"
                autoFocus
                onClick={() => setDataResetDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-danger"
                onClick={
                  dataResetDialog === "all"
                    ? handleDeleteAllQuizData
                    : dataResetDialog === "history"
                      ? handleClearHistory
                      : handleResetEverything
                }
              >
                <Icon name="trash" size={15} />
                {dataResetDialog === "all"
                  ? "Yes, delete all quizzes"
                  : dataResetDialog === "history"
                    ? "Clear history"
                    : "Reset everything"}
              </button>
            </div>
          </section>
        </div>
      )}

      {hostAuthQuiz && (
        <div
          className="auth-dialog-backdrop"
          onClick={() => {
            setHostAuthQuiz(null);
            setHostPasswordInput("");
            setHostPasswordError("");
          }}
        >
          <section
            className="auth-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="host-auth-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="auth-dialog-icon"><Icon name="lock" size={22} /></span>
            <span className="section-kicker">HOST AUTHENTICATION · SURAJ M</span>
            <h2 id="host-auth-title">Host Password Required</h2>
            <p>Enter the admin password to launch and host <strong>“{hostAuthQuiz.title}”</strong>.</p>
            <form onSubmit={submitHostAuth}>
              <div className="auth-input-wrap">
                <input
                  type={showHostPassword ? "text" : "password"}
                  className="auth-input"
                  placeholder="Enter host password"
                  value={hostPasswordInput}
                  onChange={(e) => {
                    setHostPasswordInput(e.target.value);
                    if (hostPasswordError) setHostPasswordError("");
                  }}
                  autoFocus
                  required
                />
                <button
                  type="button"
                  className="auth-toggle-pass"
                  onClick={() => setShowHostPassword(!showHostPassword)}
                >
                  {showHostPassword ? "Hide" : "Show"}
                </button>
              </div>
              {hostPasswordError && (
                <div className="auth-error-msg">
                  <Icon name="lock" size={14} />
                  <span>{hostPasswordError}</span>
                </div>
              )}
              <div className="auth-dialog-actions">
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => {
                    setHostAuthQuiz(null);
                    setHostPasswordInput("");
                    setHostPasswordError("");
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="button button-dark">
                  <Icon name="play" size={15} /> Unlock & Host
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {adminLoginOpen && (
        <div
          className="auth-dialog-backdrop"
          onClick={() => {
            setAdminLoginOpen(false);
            setAdminPasswordInput("");
            setAdminPasswordError("");
          }}
        >
          <section
            className="auth-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-login-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="auth-dialog-icon"><Icon name="lock" size={22} /></span>
            <span className="section-kicker">HOST ACCESS · SURAJ M</span>
            <h2 id="admin-login-title">Host Admin Login</h2>
            <p>Enter the admin password to access the quiz workspace and host live quizzes.</p>
            <form onSubmit={submitAdminLogin}>
              <div className="auth-input-wrap">
                <input
                  type={showAdminPassword ? "text" : "password"}
                  className="auth-input"
                  placeholder="Enter admin password"
                  value={adminPasswordInput}
                  onChange={(e) => {
                    setAdminPasswordInput(e.target.value);
                    if (adminPasswordError) setAdminPasswordError("");
                  }}
                  autoFocus
                  required
                />
                <button
                  type="button"
                  className="auth-toggle-pass"
                  onClick={() => setShowAdminPassword(!showAdminPassword)}
                >
                  {showAdminPassword ? "Hide" : "Show"}
                </button>
              </div>
              {adminPasswordError && (
                <div className="auth-error-msg">
                  <Icon name="lock" size={14} />
                  <span>{adminPasswordError}</span>
                </div>
              )}
              <div className="auth-dialog-actions">
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => {
                    setAdminLoginOpen(false);
                    setAdminPasswordInput("");
                    setAdminPasswordError("");
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="button button-dark">
                  <Icon name="arrow" size={15} /> Log In
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {view === "home" && (
        <div className="site-shell">
          <header className="topbar">
            <button type="button" className="logo-button" onClick={() => setView("home")} aria-label="Quizz home">
              <Logo />
            </button>
            <nav className="top-links" aria-label="Main navigation">
              <a href="#how-it-works">How it works</a>
              <a href="#for-hosts">For hosts</a>
            </nav>
            <button type="button" className="top-admin" onClick={() => navigateToAdmin("overview")}>
              Host a quiz <Icon name="arrow" size={16} />
            </button>
          </header>

          <main>
            <section className="hero-section">
              <div className="hero-copy">
                <div className="eyebrow"><span className="eyebrow-spark"><Icon name="sparkles" size={14} /></span> A little friendly competition</div>
                <h1>Good questions.<br /><span>Great moments.</span></h1>
                <p className="hero-description">
                  Host real-time quizzes for classrooms, teams, and live events—no downloads or sign-ups for players.
                </p>
                <div className="hero-actions">
                  <a className="button button-dark" href="#join-card">Join a quiz <Icon name="arrow" size={17} /></a>
                  <button type="button" className="button button-soft" onClick={() => navigateToAdmin("overview")}>
                    <Icon name="crown" size={17} /> I&apos;m hosting
                  </button>
                </div>
                <div className="social-proof">
                  <div className="avatar-stack" aria-hidden="true"><span>J</span><span>M</span><span>A</span><span>+</span></div>
                  <div><strong>Made for curious minds</strong><small>Learning is better together</small></div>
                </div>
              </div>

              <div className="join-card-wrap" id="join-card">
                <div className="floating-chip floating-chip-top"><span className="live-dot" /> Ready when you are</div>
                <div className="join-card">
                  <div className="join-card-top">
                    <div className="join-card-icon"><Icon name={joinStep === "code" ? "lightning" : "users"} size={20} /></div>
                    <span className="preview-badge">QUICK JOIN</span>
                  </div>
                  <div className="join-card-heading">
                    <span className="step-count">STEP {joinStep === "code" ? "01" : "02"} <i /> 02</span>
                    <h2>{joinStep === "code" ? "You’re invited." : "One last thing."}</h2>
                    <p>{joinStep === "code" ? "Enter the 6-digit room code to jump straight into the live lobby." : "What should we call you in the quiz?"}</p>
                  </div>
                  {joinStep === "code" ? (
                    <form onSubmit={submitCode}>
                      <label className="field-label" htmlFor="quiz-code">YOUR 6-DIGIT CODE</label>
                      <input
                        id="quiz-code"
                        className="code-input"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="• • • • • •"
                        value={code}
                        onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setJoinError(""); }}
                        aria-describedby={joinError ? "join-error" : undefined}
                        autoFocus={false}
                      />
                      {joinError && <p className="field-error" id="join-error">{joinError}</p>}
                      <button className="button button-lime button-wide" type="submit">Find my quiz <Icon name="arrow" size={17} /></button>
                    </form>
                  ) : (
                    <form onSubmit={submitName}>
                      <div className="code-confirmed"><span className="confirmed-check"><Icon name="check" size={13} /></span> Quiz code <strong>{code}</strong><button type="button" onClick={() => { setJoinStep("code"); setJoinError(""); }}>Change</button></div>
                      <label className="field-label" htmlFor="full-name">YOUR FULL NAME</label>
                      <input
                        id="full-name"
                        className="name-input"
                        type="text"
                        autoComplete="name"
                        maxLength={60}
                        placeholder="e.g. Alex Morgan"
                        value={fullName}
                        onChange={(event) => { setFullName(event.target.value); setJoinError(""); }}
                        autoFocus
                      />
                      {joinError && <p className="field-error" id="join-error">{joinError}</p>}
                      <button className="button button-lime button-wide" type="submit">Join the quiz <Icon name="arrow" size={17} /></button>
                    </form>
                  )}
                  <div className="join-card-foot"><Icon name="globe" size={14} /> Instant entry • No account needed</div>
                </div>
                <div className="floating-chip floating-chip-bottom"><span className="mini-avatar">✦</span> Instant lobby access • No account required</div>
              </div>
            </section>

            <section className="how-section" id="how-it-works">
              <div className="section-intro">
                <span className="section-kicker">SIMPLE AS 1, 2, FUN</span>
                <h2>Less setup. More <span>“let’s go!”</span></h2>
              </div>
              <div className="steps-grid">
                <article className="step-card">
                  <div className="step-icon step-icon-purple"><Icon name="book" size={20} /></div>
                  <span className="step-number">01</span>
                  <h3>Get your code</h3>
                  <p>Type the 6-digit room code from your host to drop straight into the session in seconds.</p>
                </article>
                <article className="step-card">
                  <div className="step-icon step-icon-peach"><Icon name="users" size={20} /></div>
                  <span className="step-number">02</span>
                  <h3>Bring your name</h3>
                  <p>Pick a nickname in the waiting room and watch players join live before round one starts.</p>
                </article>
                <article className="step-card">
                  <div className="step-icon step-icon-lime"><Icon name="lightning" size={20} /></div>
                  <span className="step-number">03</span>
                  <h3>Beat the clock</h3>
                  <p>Answer timed questions as they drop, climb the live leaderboard, and claim top spot.</p>
                </article>
              </div>
            </section>

            <section className="host-banner" id="for-hosts">
              <div className="host-banner-icon"><Icon name="crown" size={21} /></div>
              <div className="host-banner-copy">
                <span>FOR THE QUIZ-MAKERS</span>
                <h2>Build rounds in minutes. Run live games your room actually remembers.</h2>
                <p>Custom timers, instant room codes, and live scoreboards built for hosts.</p>
              </div>
              <button type="button" className="button button-light" onClick={() => navigateToAdmin("create")}>
                Make a quiz <Icon name="arrow" size={17} />
              </button>
              <div className="host-banner-orb" aria-hidden="true" />
            </section>
          </main>
          <footer className="site-footer"><Logo /><span>Live quizzes that keep every screen in the room.</span><span>© 2026 Quizz</span></footer>
        </div>
      )}

      {view === "admin" && !isAdminAuthenticated && (
        <div className="admin-login-shell">
          <header className="play-header">
            <button type="button" className="logo-button" onClick={() => setView("home")}><Logo /></button>
            <button type="button" className="button button-outline small-button" onClick={() => setView("home")}>Back to join page</button>
          </header>
          <div className="admin-login-wrap">
            <section className="auth-dialog admin-login-card">
              <span className="auth-dialog-icon"><Icon name="lock" size={24} /></span>
              <span className="section-kicker">HOST ACCESS · SURAJ M</span>
              <h2>Host Admin Login</h2>
              <p>Enter the admin password to access the quiz workspace, manage quizzes, and host live sessions.</p>
              <form onSubmit={submitAdminLogin}>
                <div className="auth-input-wrap">
                  <input
                    type={showAdminPassword ? "text" : "password"}
                    className="auth-input"
                    placeholder="Enter admin password"
                    value={adminPasswordInput}
                    onChange={(e) => {
                      setAdminPasswordInput(e.target.value);
                      if (adminPasswordError) setAdminPasswordError("");
                    }}
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    className="auth-toggle-pass"
                    onClick={() => setShowAdminPassword(!showAdminPassword)}
                  >
                    {showAdminPassword ? "Hide" : "Show"}
                  </button>
                </div>
                {adminPasswordError && (
                  <div className="auth-error-msg">
                    <Icon name="lock" size={14} />
                    <span>{adminPasswordError}</span>
                  </div>
                )}
                <div className="auth-dialog-actions">
                  <button type="button" className="button button-outline" onClick={() => setView("home")}>
                    Cancel
                  </button>
                  <button type="submit" className="button button-dark">
                    <Icon name="arrow" size={15} /> Log In
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>
      )}

      {view === "admin" && isAdminAuthenticated && (
        <div className={`admin-shell${adminTab === "host" ? " admin-shell-host-mode" : ""}`}>
          {adminTab === "host" && hostSidebarOpen && (
            <div
              className="drawer-backdrop"
              onClick={() => setHostSidebarOpen(false)}
              aria-hidden="true"
            />
          )}
          <aside className={`sidebar${adminTab === "host" ? " host-mode-drawer" : ""}${hostSidebarOpen ? " drawer-open" : ""}`}>
            <div className="sidebar-top-bar">
              <button type="button" className="logo-button sidebar-logo" onClick={() => { setView("home"); setHostSidebarOpen(false); }}><Logo light /></button>
              {adminTab === "host" && (
                <button
                  type="button"
                  className="drawer-close-btn"
                  aria-label="Close menu"
                  title="Close menu"
                  onClick={() => setHostSidebarOpen(false)}
                >
                  ×
                </button>
              )}
            </div>
            <div className="sidebar-label">WORKSPACE</div>
            <nav className="side-nav" aria-label="Admin navigation">
              <button type="button" className={adminTab === "overview" ? "side-link active" : "side-link"} onClick={() => { setAdminTab("overview"); setHostSidebarOpen(false); }}><Icon name="layout" /> Overview</button>
              <button type="button" className={adminTab === "quizzes" ? "side-link active" : "side-link"} onClick={() => { setAdminTab("quizzes"); setHostSidebarOpen(false); }}><Icon name="book" /> My quizzes <span className="nav-count">{quizzes.length}</span></button>
              <button type="button" className={adminTab === "create" ? "side-link active" : "side-link"} onClick={() => { setAdminTab("create"); setHostSidebarOpen(false); }}><Icon name="plus" /> Create a quiz</button>
              {showLiveHostTab && (
                <button
                  type="button"
                  className={adminTab === "host" ? "side-link active side-link-live" : "side-link side-link-live"}
                  onClick={() => { setAdminTab("host"); setHostSidebarOpen(false); }}
                >
                  <Icon name="play" />
                  <span>Live host</span>
                  {hasActiveQuiz && <span className="live-pulse-dot" title="Active live quiz in session" />}
                </button>
              )}
              <button type="button" className={adminTab === "settings" ? "side-link active" : "side-link"} onClick={() => { setAdminTab("settings"); setHostSidebarOpen(false); }}><Icon name="settings" /> Settings</button>
            </nav>
            <div className="sidebar-spacer" />
            <div className="profile-badge">
              <span className="profile-avatar">S</span>
              <span className="profile-info"><strong>Suraj M</strong><small>Quiz host</small></span>
              <button
                type="button"
                className="profile-logout-btn"
                title="Log out of admin workspace"
                onClick={logoutAdmin}
              >
                Log out
              </button>
            </div>
          </aside>

          <main className="admin-main">
            {adminTab !== "host" && (
              <header className="admin-topbar">
                <div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={14} /><strong>{adminTab === "create" ? (editingQuizId ? "Edit quiz" : "Create a quiz") : adminTab === "quizzes" ? "My quizzes" : adminTab === "settings" ? "Settings" : "Overview"}</strong></div>
                <div className="admin-top-actions">
                  <span className={`preview-mode${serviceConnected ? " service-online" : " service-offline"}`}><span className="preview-dot" /> {serviceConnected ? "LIVE SERVICE CONNECTED" : "LIVE SERVICE OFFLINE"}</span>
                  <button type="button" className="button button-outline small-button" onClick={() => setView("home")}>Back to join page</button>
                  <button type="button" className="button button-outline small-button" onClick={logoutAdmin}>Log out</button>
                </div>
              </header>
            )}

            {adminTab === "overview" && (
              <div className="admin-content">
                <div className="dashboard-heading">
                  <div><span className="section-kicker">YOUR QUIZ WORKSPACE</span><h1>Good evening, Suraj <span className="wave">✦</span></h1><p>Your next great quiz is just a few questions away.</p></div>
                  <button type="button" className="button button-dark" onClick={() => setAdminTab("create")}><Icon name="plus" size={17} /> Create a quiz</button>
                </div>

                {createdCode && (
                  <div className="code-share-banner">
                    <div className="share-icon"><Icon name="lightning" size={19} /></div>
                    <div><strong>Your quiz code is ready to share</strong><span>Send this code to your players to let them join.</span></div>
                    <div className="share-code">{createdCode}</div>
                    <button type="button" className="copy-button" onClick={() => copyCode(createdCode)}><Icon name="copy" size={16} /> Copy code</button>
                    <button type="button" className="copy-button refresh-code-btn" title="Generate new code" onClick={refreshCreatedCode}><Icon name="refresh" size={15} /> New code</button>
                    <button type="button" className="banner-dismiss" aria-label="Dismiss" onClick={() => setCreatedCode("")}>×</button>
                  </div>
                )}

                <div className="stat-grid">
                  <article className="stat-card">
                    <div className="stat-label"><span className="stat-icon stat-violet"><Icon name="book" size={16} /></span> TOTAL QUIZZES</div>
                    <div className="stat-value">{quizzes.length}</div>
                    <div className="stat-note">{quizzes.length === 0 ? "Ready to build your first quiz" : "Questions ready to host"}</div>
                  </article>
                  <article className="stat-card">
                    <div className="stat-label"><span className="stat-icon stat-peach"><Icon name="users" size={16} /></span> PLAYERS REACHED</div>
                    <div className="stat-value">{totalParticipantsCount}</div>
                    <div className="stat-note">Across all your trial sessions</div>
                  </article>
                  <article className="stat-card">
                    <div className="stat-label"><span className="stat-icon stat-lime"><Icon name="lightning" size={16} /></span> QUIZ SESSIONS</div>
                    <div className="stat-value">{completedSessionsCount}</div>
                    <div className="stat-note">Every answer counts</div>
                  </article>
                </div>

                <section className="dashboard-panel">
                  <div className="panel-heading">
                    <div><h2>Your quizzes</h2><p>A little knowledge goes a long way.</p></div>
                    {quizzes.length > 0 && (
                      <button type="button" className="text-button" onClick={() => setAdminTab("quizzes")}>View all <Icon name="arrow" size={15} /></button>
                    )}
                  </div>
                  {quizzes.length === 0 ? (
                    <div className="empty-workspace-state">
                      <div className="empty-icon-wrap"><Icon name="sparkles" size={26} /></div>
                      <h3>No quizzes created yet</h3>
                      <p>Your workspace is clean and ready for your first real trial! Build your first quiz with questions and answers to start hosting live rooms.</p>
                      <button type="button" className="button button-dark" onClick={() => setAdminTab("create")}>
                        <Icon name="plus" size={16} /> Create your first quiz
                      </button>
                    </div>
                  ) : (
                    <div className="quiz-table">
                      <div className="quiz-table-head"><span>QUIZ</span><span>CODE</span><span>PLAYERS</span><span>STATUS</span><span>ACTIONS</span></div>
                      {quizzes.slice(0, 3).map((quiz) => {
                        const status = getQuizStatus(quiz);
                        const isLiveOrWaiting = status === "Waiting" || status === "Live";
                        return (
                          <div className="quiz-row" key={quiz.id}>
                            <div className="quiz-title-cell">
                              <span className="quiz-row-icon"><Icon name="sparkles" size={16} /></span>
                              <span>
                                <strong>{quiz.title}</strong>
                                <small>
                                  {quiz.date}
                                  <span className="mobile-status-tag"> · <span className={`status-pill status-${status.toLowerCase()}`}><i /> {status}</span></span>
                                </small>
                              </span>
                            </div>
                            <div className="table-code-wrap">
                              <button type="button" className="table-code" title="Click to copy code" onClick={() => copyCode(quiz.code)}>{quiz.code}<Icon name="copy" size={13} /></button>
                              <button type="button" className="table-code-refresh" title="Generate a new code for this quiz" onClick={() => refreshQuizCode(quiz)}><Icon name="refresh" size={12} /></button>
                            </div>
                            <span className="player-count"><Icon name="users" size={15} /> {quiz.participants}</span>
                            <span className={`status-pill status-${status.toLowerCase()}`}><i /> {status}</span>
                            <div className="quiz-row-actions">
                              <button type="button" className="row-edit" aria-label={`Edit ${quiz.title}`} disabled={isLiveOrWaiting} title={isLiveOrWaiting ? "End the live room before editing" : undefined} onClick={() => editQuiz(quiz)}><Icon name="edit" size={13} /><span>Edit</span></button>
                              <button type="button" className={`row-host${isLiveOrWaiting ? " is-live" : ""}`} aria-label={isLiveOrWaiting ? `Resume host session for ${quiz.title}` : `Host ${quiz.title}`} title={isLiveOrWaiting ? "Resume active host session" : "Start hosting this quiz"} onClick={() => requestHostQuiz(quiz)}><Icon name="play" size={13} /><span>{isLiveOrWaiting ? "Resume" : "Host"}</span></button>
                              {isLiveOrWaiting && (
                                <button
                                  type="button"
                                  className="row-end"
                                  aria-label={`End live session for ${quiz.title}`}
                                  title="End live host session"
                                  onClick={() => {
                                    if (window.confirm(`End live host session for "${quiz.title}"?`)) {
                                      endQuizRoom(quiz);
                                    }
                                  }}
                                >
                                  <Icon name="lock" size={12} />
                                  <span>End live</span>
                                </button>
                              )}
                              <button type="button" className="row-delete" aria-label={`Delete ${quiz.title}`} title={isLiveOrWaiting ? "End the live room before deleting" : "Delete quiz"} disabled={isLiveOrWaiting} onClick={() => requestQuizDeletion(quiz)}><Icon name="trash" size={13} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="dashboard-panel history-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Recent Trial History <span className="muted-count">{historyRecords.length}</span></h2>
                      <p>Completed live quiz runs, timestamps, and participant turnouts are kept here.</p>
                    </div>
                    {historyRecords.length > 0 && (
                      <button
                        type="button"
                        className="text-button text-button-danger"
                        onClick={() => setDataResetDialog("history")}
                        title="Clear trial history"
                      >
                        Clear history
                      </button>
                    )}
                  </div>
                  {historyRecords.length === 0 ? (
                    <div className="history-empty-note">
                      <Icon name="clock" size={16} />
                      <span>No trial sessions completed yet. Host a live quiz and finish the room to record session stats here.</span>
                    </div>
                  ) : (
                    <div className="history-list">
                      {historyRecords.slice(0, 5).map((record) => (
                        <div className="history-item" key={record.id}>
                          <div className="history-item-left">
                            <span className="history-badge"><Icon name="lightning" size={14} /></span>
                            <div>
                              <strong>{record.title}</strong>
                              <small>Room PIN: {record.code} · {record.date}</small>
                            </div>
                          </div>
                          <div className="history-item-right">
                            <span className="history-players"><Icon name="users" size={14} /> {record.participants} {record.participants === 1 ? "player" : "players"}</span>
                            {record.topScore && (
                              <span className="history-winner">🏆 {record.topScore.name} ({record.topScore.score.toLocaleString()} pts)</span>
                            )}
                            <span className="status-pill status-completed"><i /> Completed</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <div className="bottom-note"><span className="note-icon"><Icon name="sparkles" size={16} /></span><p><strong>A small tip:</strong> A 15–20 second timer keeps things lively without making anyone feel rushed.</p><button type="button" onClick={() => setAdminTab("create")}>Add your next quiz <Icon name="arrow" size={14} /></button></div>
              </div>
            )}

            {adminTab === "quizzes" && (
              <div className="admin-content">
                <div className="dashboard-heading">
                  <div>
                    <span className="section-kicker">YOUR LITTLE CORNER OF KNOWLEDGE</span>
                    <h1>My quizzes</h1>
                    <p>All your questions, ready to bring people together.</p>
                  </div>
                  <div className="heading-actions">
                    {quizzes.length > 0 && (
                      <button
                        type="button"
                        className="button button-danger-outline"
                        onClick={() => setDataResetDialog("all")}
                        title="Delete all quiz data"
                      >
                        <Icon name="trash" size={15} /> Delete all data
                      </button>
                    )}
                    <button type="button" className="button button-dark" onClick={() => setAdminTab("create")}>
                      <Icon name="plus" size={17} /> Create a quiz
                    </button>
                  </div>
                </div>
                <section className="dashboard-panel quiz-list-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>All quizzes <span className="muted-count">{quizzes.length}</span></h2>
                      <p>Click a code to copy it, or preview a quiz to try it out.</p>
                    </div>
                  </div>
                  {quizzes.length === 0 ? (
                    <div className="empty-workspace-state">
                      <div className="empty-icon-wrap"><Icon name="book" size={26} /></div>
                      <h3>No quizzes in your library</h3>
                      <p>Get ready for your first trial session. Create questions, customize timers, and invite participants to join live with a code.</p>
                      <button type="button" className="button button-dark" onClick={() => setAdminTab("create")}>
                        <Icon name="plus" size={16} /> Create a quiz now
                      </button>
                    </div>
                  ) : (
                    <div className="quiz-table">
                      <div className="quiz-table-head"><span>QUIZ</span><span>CODE</span><span>PLAYERS</span><span>STATUS</span><span>ACTIONS</span></div>
                      {quizzes.map((quiz) => {
                        const status = getQuizStatus(quiz);
                        const isLiveOrWaiting = status === "Waiting" || status === "Live";
                        return (
                          <div className="quiz-row" key={quiz.id}>
                            <div className="quiz-title-cell">
                              <span className="quiz-row-icon"><Icon name="sparkles" size={16} /></span>
                              <span>
                                <strong>{quiz.title}</strong>
                                <small>
                                  {quiz.date}
                                  <span className="mobile-status-tag"> · <span className={`status-pill status-${status.toLowerCase()}`}><i /> {status}</span></span>
                                </small>
                              </span>
                            </div>
                            <div className="table-code-wrap">
                              <button type="button" className="table-code" title="Click to copy code" onClick={() => copyCode(quiz.code)}>{quiz.code}<Icon name="copy" size={13} /></button>
                              <button type="button" className="table-code-refresh" title="Generate a new code for this quiz" onClick={() => refreshQuizCode(quiz)}><Icon name="refresh" size={12} /></button>
                            </div>
                            <span className="player-count"><Icon name="users" size={15} /> {quiz.participants}</span>
                            <span className={`status-pill status-${status.toLowerCase()}`}><i /> {status}</span>
                            <div className="quiz-row-actions">
                              <button type="button" className="row-edit" aria-label={`Edit ${quiz.title}`} disabled={isLiveOrWaiting} title={isLiveOrWaiting ? "End the live room before editing" : undefined} onClick={() => editQuiz(quiz)}><Icon name="edit" size={13} /><span>Edit</span></button>
                              <button type="button" className={`row-host${isLiveOrWaiting ? " is-live" : ""}`} aria-label={isLiveOrWaiting ? `Resume host session for ${quiz.title}` : `Host ${quiz.title}`} title={isLiveOrWaiting ? "Resume active host session" : "Start hosting this quiz"} onClick={() => requestHostQuiz(quiz)}><Icon name="play" size={13} /><span>{isLiveOrWaiting ? "Resume" : "Host"}</span></button>
                              {isLiveOrWaiting && (
                                <button
                                  type="button"
                                  className="row-end"
                                  aria-label={`End live session for ${quiz.title}`}
                                  title="End live host session"
                                  onClick={() => {
                                    if (window.confirm(`End live host session for "${quiz.title}"?`)) {
                                      endQuizRoom(quiz);
                                    }
                                  }}
                                >
                                  <Icon name="lock" size={12} />
                                  <span>End live</span>
                                </button>
                              )}
                              <button type="button" className="row-delete" aria-label={`Delete ${quiz.title}`} title={isLiveOrWaiting ? "End the live room before deleting" : "Delete quiz"} disabled={isLiveOrWaiting} onClick={() => requestQuizDeletion(quiz)}><Icon name="trash" size={13} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}

            {adminTab === "create" && (
              <div className="admin-content create-content">
                <div className="dashboard-heading create-heading">
                  <div><span className="section-kicker">{editingQuizId ? "REFINE YOUR QUESTIONS" : "MAKE SOMETHING MEMORABLE"}</span><h1>{editingQuizId ? "Edit your quiz" : "Build your quiz"}</h1><p>{editingQuizId ? "Keep the code, make the content better." : "Set the scene, add your questions, and let the good times roll."}</p></div>
                  <div className="create-heading-art"><Icon name="sparkles" size={31} /></div>
                </div>
                <form className="quiz-builder" onSubmit={saveQuiz}>
                  <section className="builder-section">
                    <div className="builder-section-heading"><span className="builder-step">01</span><div><h2>Start with the basics</h2><p>Give your quiz a title that makes people curious.</p></div></div>
                    <div className="builder-fields">
                      <label className="builder-label">QUIZ TITLE<input type="text" maxLength={80} placeholder="e.g. Friday team brain-break" value={quizTitle} onChange={(event) => setQuizTitle(event.target.value)} /></label>
                      <label className="builder-label">A LITTLE CONTEXT <span className="optional-label">OPTIONAL</span><textarea rows={2} maxLength={180} placeholder="What’s this quiz all about?" value={quizDescription} onChange={(event) => setQuizDescription(event.target.value)} /></label>
                    </div>
                  </section>

                  <section className="builder-section question-builder-section">
                    <div className="builder-section-heading"><span className="builder-step">02</span><div><h2>Write your questions</h2><p>Add four choices and pick the right answer. You can add more anytime.</p></div></div>
                    <div className="question-list">
                      {draftQuestions.map((question, index) => (
                        <article className="question-editor" key={index}>
                          <div className="question-editor-top"><span className="question-number">QUESTION {String(index + 1).padStart(2, "0")}</span><div className="question-editor-tools"><label className="timer-select"><Icon name="clock" size={14} /><select aria-label={`Time limit for question ${index + 1}`} value={question.seconds} onChange={(event) => updateQuestion(index, { seconds: Number(event.target.value) })}><option value={10}>10 sec</option><option value={15}>15 sec</option><option value={20}>20 sec</option><option value={30}>30 sec</option><option value={45}>45 sec</option><option value={60}>60 sec</option></select></label>{draftQuestions.length > 1 && <button type="button" className="remove-question" aria-label={`Remove question ${index + 1}`} onClick={() => setDraftQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>}</div></div>
                          <label className="visually-hidden" htmlFor={`question-${index}`}>Question {index + 1} text</label>
                          <input id={`question-${index}`} className="question-prompt-input" type="text" maxLength={180} placeholder="Type your question here…" value={question.prompt} onChange={(event) => updateQuestion(index, { prompt: event.target.value })} />

                          <div className="question-image-field">
                            <div className="question-image-header">
                              <span className="question-image-label">
                                <Icon name="image" size={13} />
                                <span>QUESTION IMAGE <small className="optional-tag">(OPTIONAL)</small></span>
                              </span>
                              {question.imageUrl && (
                                <button
                                  type="button"
                                  className="clear-image-btn"
                                  onClick={() => updateQuestion(index, { imageUrl: "" })}
                                >
                                  Remove image
                                </button>
                              )}
                            </div>
                            <div className="question-image-input-row">
                              <input
                                type="url"
                                className="question-image-input"
                                placeholder="Paste image URL (https://...) or click a preset below"
                                value={question.imageUrl ?? ""}
                                onChange={(event) => updateQuestion(index, { imageUrl: event.target.value })}
                              />
                            </div>
                            <div className="question-image-presets">
                              <span className="presets-label">Quick sample:</span>
                              <button
                                type="button"
                                className="preset-chip"
                                onClick={() => updateQuestion(index, { imageUrl: "https://images.unsplash.com/photo-1614728894747-a83421e2b9c9?w=900&auto=format&fit=crop&q=80" })}
                              >
                                🪐 Space
                              </button>
                              <button
                                type="button"
                                className="preset-chip"
                                onClick={() => updateQuestion(index, { imageUrl: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=900&auto=format&fit=crop&q=80" })}
                              >
                                🌿 Nature
                              </button>
                              <button
                                type="button"
                                className="preset-chip"
                                onClick={() => updateQuestion(index, { imageUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=900&auto=format&fit=crop&q=80" })}
                              >
                                💻 Tech
                              </button>
                              <button
                                type="button"
                                className="preset-chip"
                                onClick={() => updateQuestion(index, { imageUrl: "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=900&auto=format&fit=crop&q=80" })}
                              >
                                🎨 Art
                              </button>
                            </div>
                            {question.imageUrl && (
                              <div className="question-image-preview">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={question.imageUrl}
                                  alt={`Preview for question ${index + 1}`}
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = "none";
                                  }}
                                />
                                <span className="image-preview-badge">Visual preview</span>
                              </div>
                            )}
                          </div>

                          <div className="answer-grid">
                            {question.options.map((option, optionIndex) => (
                              <label className={`answer-option answer-option-${optionIndex}${question.correctIndex === optionIndex ? " answer-option-correct" : ""}`} key={optionIndex}>
                                <span className="answer-letter">{String.fromCharCode(65 + optionIndex)}</span>
                                <input type="text" maxLength={100} placeholder={`Answer choice ${String.fromCharCode(65 + optionIndex)}`} value={option} onChange={(event) => updateQuestion(index, { options: question.options.map((value, i) => i === optionIndex ? event.target.value : value) })} />
                                <input className="correct-radio" type="radio" name={`correct-${index}`} aria-label={`Mark choice ${String.fromCharCode(65 + optionIndex)} correct`} checked={question.correctIndex === optionIndex} onChange={() => updateQuestion(index, { correctIndex: optionIndex })} />
                              </label>
                            ))}
                          </div>
                          <div className="correct-hint"><span className="tiny-check"><Icon name="check" size={11} /></span> Click the circle to mark the correct answer</div>
                        </article>
                      ))}
                    </div>
                    <button type="button" className="add-question-button" onClick={() => setDraftQuestions((current) => [...current, makeQuestion(hostSettings.defaultSeconds)])}><span><Icon name="plus" size={16} /></span> Add a question</button>
                  </section>

                  <div className="builder-footer">
                    <p><Icon name="globe" size={15} /> Your quiz is saved in this browser. Live rooms run on the realtime service.</p>
                    <div><button type="button" className="button button-outline" onClick={() => { setEditingQuizId(null); setAdminTab("quizzes"); }}>Cancel</button><button type="submit" className="button button-dark">{editingQuizId ? "Save changes" : "Save quiz"} <Icon name="arrow" size={16} /></button></div>
                  </div>
                </form>
              </div>
            )}

            {adminTab === "host" && (
              <div className="admin-content host-content">
                <div className="dashboard-heading host-dashboard-heading">
                  <div className="host-heading-row">
                    <button
                      type="button"
                      className="host-hamburger-btn"
                      aria-label="Open sidebar menu"
                      title="Open navigation menu"
                      onClick={() => setHostSidebarOpen(true)}
                    >
                      <Icon name="menu" size={17} />
                      <span>Menu</span>
                    </button>
                    <div>
                      <span className="section-kicker">HOST CONSOLE</span>
                      <h1>{hostSession?.status === "live" ? "You’re live!" : hostSession?.status === "ended" ? "Quiz finished" : "Your room is ready"}</h1>
                      <p>{activeHostQuiz?.title ?? hostSession?.title ?? "Prepare the room and bring your students in."}</p>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "8px", fontSize: "12px", fontWeight: 600 }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: serviceConnected ? "#10b981" : "#f59e0b", display: "inline-block", boxShadow: serviceConnected ? "0 0 8px #10b981" : "none" }} />
                        <span style={{ color: serviceConnected ? "#059669" : "#d97706" }}>
                          {serviceConnected ? "Live Multiplayer Connected" : "Connecting to Multiplayer Hub..."}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="host-top-controls">
                    {activeHostQuiz && (
                      <div className="host-share-code">
                        <span>QUIZ CODE</span>
                        <strong>{activeHostQuiz.code}</strong>
                        <div className="host-code-actions">
                          <button type="button" title="Copy room code" onClick={() => copyCode(activeHostQuiz.code)}><Icon name="copy" size={13} /> Copy</button>
                        </div>
                      </div>
                    )}
                    {hostSession?.status !== "ended" ? (
                      <button
                        type="button"
                        className="button button-danger small-button"
                        onClick={() => {
                          if (window.confirm("End this live host session? Joined participants will see the quiz end.")) {
                            updateHostedQuiz("host:end");
                          }
                        }}
                      >
                        <Icon name="lock" size={13} /> End live host
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button button-outline small-button"
                        onClick={() => setAdminTab("quizzes")}
                      >
                        Exit to My Quizzes
                      </button>
                    )}
                  </div>
                </div>
                <div className="host-console-grid">
                  <section className="host-stage-card">
                    {hostSession?.status === "waiting" || (!hostSession && activeHostQuiz) ? (
                      <>
                        <div className="host-stage-kicker">
                          <span className={`status-pill ${serviceConnected ? "status-waiting" : "status-live"}`}>
                            <i /> {serviceConnected ? "WAITING ROOM" : "CONNECTING..."}
                          </span>
                          <span>{(hostSession?.participants?.length ?? 0)} joined</span>
                        </div>
                        <div className="waiting-stage" style={{ padding: "30px 20px" }}>
                          <span className="waiting-illustration" style={{ width: "60px", height: "60px", borderRadius: "50%", background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", color: "#4f46e5" }}>
                            <Icon name="users" size={28} />
                          </span>
                          <h2 style={{ fontSize: "24px", fontWeight: 800, margin: "14px 0 6px", color: "#111827" }}>Gather your students</h2>
                          <p style={{ fontSize: "14px", color: "#6b7280", maxWidth: "420px", margin: "0 auto 16px" }}>
                            Share the game PIN with your students to let them join:
                          </p>
                          <div className="big-room-code-wrap" style={{ margin: "10px 0 16px" }}>
                            <span className="big-room-code" style={{ fontSize: "44px", letterSpacing: "6px", color: "#4f46e5", fontWeight: 900 }}>
                              {activeHostQuiz?.code ?? hostSession?.code ?? "..."}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap", marginBottom: "24px" }}>
                            <button
                              type="button"
                              className="button button-outline small-button"
                              onClick={() => copyCode(activeHostQuiz?.code ?? hostSession?.code ?? "")}
                              title="Copy game code"
                              style={{ display: "flex", alignItems: "center", gap: "6px" }}
                            >
                              <Icon name="copy" size={14} /> Copy PIN
                            </button>
                            <button
                              type="button"
                              className="button button-outline small-button"
                              onClick={() => {
                                if (typeof window !== "undefined") {
                                  navigator.clipboard.writeText(window.location.origin);
                                  setToast("Website link copied!");
                                }
                              }}
                              title="Copy website link"
                              style={{ display: "flex", alignItems: "center", gap: "6px" }}
                            >
                              <Icon name="arrow" size={14} /> Copy Website Link
                            </button>
                          </div>

                          <div className="room-actions" style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
                            <button
                              type="button"
                              className="button button-outline"
                              onClick={() => updateHostedQuiz("host:lock", { locked: !hostSession?.locked })}
                            >
                              <Icon name={hostSession?.locked ? "lock" : "users"} size={15} />
                              {hostSession?.locked ? "Room locked" : "Lock room"}
                            </button>
                            <button
                              type="button"
                              className="button button-dark"
                              style={{
                                background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                                color: "#fff",
                                fontWeight: 700,
                                padding: "12px 28px",
                                fontSize: "15px",
                                borderRadius: "10px",
                              }}
                              disabled={!hostSession?.participants?.length}
                              onClick={() => {
                                if (hostSession && !hostSession.locked && hostSettings.autoLockOnStart) {
                                  updateHostedQuiz("host:lock", { locked: true });
                                }
                                updateHostedQuiz("host:start");
                              }}
                            >
                              <Icon name="play" size={15} /> Start quiz
                            </button>
                          </div>
                          {!hostSession?.participants?.length && (
                            <span className="host-control-hint" style={{ marginTop: "16px", color: "#6b7280" }}>
                              Joined students will show up in the live leaderboard on the right.
                            </span>
                          )}
                        </div>
                      </>
                    ) : hostSession?.status === "starting" || hostSession?.phase === "countdown" ? (
                      <>
                        <div className="host-stage-kicker">
                          <span className="status-pill status-live"><i /> GET READY</span>
                          <span>Starting in {countdownSecondsLeft}s</span>
                        </div>
                        <div className="countdown-host-stage">
                          <span className="countdown-badge"><Icon name="lightning" size={13} /> ALERTING PLAYERS</span>
                          <h2>{hostSession.questionIndex === 0 && hostSession.status === "starting" ? "Quiz starting in…" : `Question ${hostSession.questionIndex + 1} starting in…`}</h2>
                          <div className="countdown-number-pulsing host-countdown-number" key={countdownSecondsLeft}>
                            {countdownSecondsLeft > 0 ? countdownSecondsLeft : "GO!"}
                          </div>
                          <p>
                            {hostSession.questionIndex === 0 && hostSession.status === "starting"
                              ? "All joined participants are seeing the 5-second countdown alert on their screens."
                              : `All participants are seeing a 3-second alert for Question ${hostSession.questionIndex + 1}.`}
                          </p>
                        </div>
                      </>
                    ) : hostSession?.status === "live" && hostSession.question ? (
                      <>
                        <div className="host-stage-kicker">
                          <span className={`status-pill ${isQuestionRevealed ? "status-ready" : "status-live"}`}>
                            <i /> {isQuestionRevealed ? "QUESTION FINISHED" : "LIVE QUESTION"}
                          </span>
                          <span>QUESTION {String(hostSession.questionIndex + 1).padStart(2, "0")} OF {String(hostSession.questionCount).padStart(2, "0")}</span>
                        </div>
                        <div className="host-live-question">
                          <div className={`host-timer${!isQuestionRevealed && hostSecondsLeft <= 5 ? " timer-warning" : ""}${isQuestionRevealed ? " host-timer-done" : ""}`}>
                            <Icon name="clock" size={16} /> {isQuestionRevealed ? "Timer completed" : `${hostSecondsLeft}s`}
                          </div>
                          {hostSession.question.imageUrl && (
                            <div className="host-question-media">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={hostSession.question.imageUrl} alt="Question visual prompt" />
                            </div>
                          )}
                          <h2>{hostSession.question.prompt}</h2>
                          <div className="host-answer-list">
                            {hostSession.question.options.map((option, index) => {
                              const isCorrect = isQuestionRevealed && index === hostSession.question?.correctIndex;
                              const isDimmed = isQuestionRevealed && !isCorrect;
                              return (
                                <div
                                  className={`host-answer host-color-${index}${isCorrect ? " is-correct-answer" : ""}${isDimmed ? " is-dimmed" : ""}`}
                                  key={`${hostSession.questionIndex}-${option}`}
                                >
                                  <div className="host-answer-inner">
                                    <div className="host-answer-label-group">
                                      <span className="host-answer-letter">{String.fromCharCode(65 + index)}</span>
                                      <span className="host-answer-text">{option}</span>
                                    </div>
                                    {isCorrect && (
                                      <span className="host-correct-badge">
                                        <Icon name="check" size={13} /> Correct Answer
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="host-live-footer">
                            <span>
                              {!isQuestionRevealed
                                ? `${hostSession.participants.filter((participant) => participant.answeredCurrent).length} / ${hostSession.participants.length} answers in`
                                : `Timer completed · Correct answer marked in green · ${hostSession.totalVotes ?? 0} answers collected`}
                            </span>
                            <div className="host-live-actions">
                              {isQuestionRevealed && (
                                hostSession.questionIndex + 1 < hostSession.questionCount ? (
                                  <button type="button" className="button button-dark small-button" onClick={() => updateHostedQuiz("host:next")}>
                                    Next question <Icon name="arrow" size={14} />
                                  </button>
                                ) : (
                                  <button type="button" className="button button-dark small-button" onClick={() => updateHostedQuiz("host:end")}>
                                    View final results <Icon name="trophy" size={14} />
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : hostSession?.status === "ended" ? (
                      <div className="host-ended-stage">
                        <WinnersPodium
                          participants={hostSession.participants}
                          title="Quiz Complete · Official Standings"
                          subtitle="Top 3 performers with their prizes and remaining participants with their final ranks."
                          onPrimaryAction={() => activeHostQuiz && requestHostQuiz(activeHostQuiz)}
                          primaryActionLabel="Open a new room"
                          onSecondaryAction={() => setAdminTab("quizzes")}
                          secondaryActionLabel="Back to Quizzes"
                        />
                      </div>
                    ) : (
                      <div className="host-ended-stage">
                        <span className="waiting-illustration"><Icon name="clock" size={24} /></span>
                        <h2>Preparing host room…</h2>
                        <p>Select a quiz from My Quizzes to start hosting.</p>
                        <button
                          type="button"
                          className="button button-primary"
                          style={{ marginTop: "12px" }}
                          onClick={() => setAdminTab("quizzes")}
                        >
                          Browse Quizzes
                        </button>
                      </div>
                    )}
                  </section>

                  <aside className="leaderboard-card">
                    <div className="leaderboard-heading"><div><span className="section-kicker">THE PEOPLE PLAYING</span><h2>Live leaderboard</h2></div><span className="leaderboard-count">{hostSession?.participants.length ?? 0}</span></div>
                    <div className="leaderboard-subhead"><span>PLAYER</span><span>SCORE</span></div>
                    {hostSession?.participants.length ? (
                      <div className="leaderboard-list">
                        {hostSession.participants.map((participant, index) => (
                          <div className="leaderboard-player" key={participant.id}>
                            <span className={`rank-badge${index < 3 ? ` rank-${index + 1}` : ""}`}>{index + 1}</span>
                            <span className="leaderboard-avatar">{participant.name.trim()[0]?.toUpperCase() ?? "?"}</span>
                            <span className="leaderboard-player-name">
                              <strong>{participant.name}</strong>
                              <small>
                                {hostSession?.status === "waiting"
                                  ? (participant.connected ? "Joined" : "Reconnecting…")
                                  : !isQuestionRevealed
                                    ? (participant.answeredCurrent ? "Answer submitted ✓" : "Thinking…")
                                    : (participant.connected
                                        ? (participant.lastAnswerCorrect !== undefined
                                            ? (participant.lastAnswerCorrect ? `Correct (+${participant.lastAnswerPoints ?? 0} pts)` : "Incorrect (+0 pts)")
                                            : `${participant.correctAnswers} correct`)
                                        : "Reconnecting…")}
                              </small>
                            </span>
                            <strong className="leaderboard-score">{participant.score.toLocaleString()}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="leaderboard-empty"><span className="empty-people"><Icon name="users" size={21} /></span><strong>No players yet</strong><p>Joined students appear here and update live.</p></div>
                    )}
                    <div className="scoring-note"><Icon name="lightning" size={14} /><span><strong>Fast + correct = more points.</strong> Up to 1,000 points for a quick correct answer.</span></div>
                  </aside>
                </div>
              </div>
            )}

            {adminTab === "settings" && (
              <div className="admin-content settings-content">
                <div className="dashboard-heading">
                  <div>
                    <span className="section-kicker">HOST PREFERENCES</span>
                    <h1>Quiz & Host Settings</h1>
                    <p>Customize default timer, scoring multipliers, gameplay restrictions, and display options.</p>
                  </div>
                </div>

                <div className="settings-grid">
                  <section className="settings-card">
                    <div className="settings-card-head">
                      <div className="settings-icon-badge"><Icon name="lock" size={18} /></div>
                      <div>
                        <h2>Host Security & Authentication</h2>
                        <p>Password protection for hosting quizzes. Host Admin: <strong>Suraj M</strong>.</p>
                      </div>
                    </div>
                    <div className="settings-toggle-list">
                      <div className="settings-security-row">
                        <div className="settings-toggle-info">
                          <strong>Host Password: Protected</strong>
                          <span>Password verification is required to start hosting live quiz sessions.</span>
                        </div>
                        <div className="security-action-group">
                          <span className={`security-chip${isHostUnlocked ? " is-unlocked" : " is-locked"}`}>
                            <Icon name="lock" size={13} />
                            {isHostUnlocked ? "Session Unlocked" : "Locked (Password Required)"}
                          </span>
                          {isHostUnlocked && (
                            <button
                              type="button"
                              className="button button-outline small-button"
                              onClick={() => {
                                setIsHostUnlocked(false);
                                setToast("Host session locked. Password will be required to host.");
                              }}
                            >
                              Lock session
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="settings-card">
                    <div className="settings-card-head">
                      <div className="settings-icon-badge"><Icon name="clock" size={18} /></div>
                      <div>
                        <h2>Default Question Time Limit</h2>
                        <p>New questions added in the quiz builder will automatically start with this timer.</p>
                      </div>
                    </div>
                    <div className="timer-pill-group">
                      {[10, 15, 20, 30, 45, 60].map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          className={`timer-pill${hostSettings.defaultSeconds === sec ? " active" : ""}`}
                          onClick={() => updateHostSettings({ defaultSeconds: sec })}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="settings-card">
                    <div className="settings-card-head">
                      <div className="settings-icon-badge"><Icon name="lightning" size={18} /></div>
                      <div>
                        <h2>Gameplay & Scoring</h2>
                        <p>Manage point bonuses and waiting room access during live quiz hosting.</p>
                      </div>
                    </div>
                    <div className="settings-toggle-list">
                      <label className="settings-toggle-item">
                        <div className="settings-toggle-info">
                          <strong>Speed bonus scoring</strong>
                          <span>Award up to 1,000 points. Faster correct responses earn more points for students.</span>
                        </div>
                        <input
                          type="checkbox"
                          className="toggle-switch"
                          checked={hostSettings.speedBonusEnabled}
                          onChange={(e) => updateHostSettings({ speedBonusEnabled: e.target.checked })}
                        />
                      </label>

                      <label className="settings-toggle-item">
                        <div className="settings-toggle-info">
                          <strong>Auto-lock room on start</strong>
                          <span>Automatically close the waiting room to late entries when the host starts the quiz.</span>
                        </div>
                        <input
                          type="checkbox"
                          className="toggle-switch"
                          checked={hostSettings.autoLockOnStart}
                          onChange={(e) => updateHostSettings({ autoLockOnStart: e.target.checked })}
                        />
                      </label>

                      <label className="settings-toggle-item">
                        <div className="settings-toggle-info">
                          <strong>Show live standings to participants</strong>
                          <span>Display current rankings and scoreboards on student screens after they answer.</span>
                        </div>
                        <input
                          type="checkbox"
                          className="toggle-switch"
                          checked={hostSettings.showLeaderboardToPlayers}
                          onChange={(e) => updateHostSettings({ showLeaderboardToPlayers: e.target.checked })}
                        />
                      </label>
                    </div>
                  </section>

                  <section className="settings-card">
                    <div className="settings-card-head">
                      <div className="settings-icon-badge"><Icon name="sparkles" size={18} /></div>
                      <div>
                        <h2>Audio & Feedback</h2>
                        <p>Audio cues and sensory feedback during gameplay.</p>
                      </div>
                    </div>
                    <div className="settings-toggle-list">
                      <label className="settings-toggle-item">
                        <div className="settings-toggle-info">
                          <strong>Sound effects & countdown alerts</strong>
                          <span>Play auditory alerts during the final seconds of countdown and round transitions.</span>
                        </div>
                        <input
                          type="checkbox"
                          className="toggle-switch"
                          checked={hostSettings.soundEffects}
                          onChange={(e) => updateHostSettings({ soundEffects: e.target.checked })}
                        />
                      </label>
                    </div>
                  </section>

                  <section className="settings-card danger-settings-card">
                    <div className="settings-card-head">
                      <div className="settings-icon-badge settings-danger-badge"><Icon name="trash" size={18} /></div>
                      <div>
                        <h2>Data & Storage Management</h2>
                        <p>Manage local quiz storage, trial session history, and workspace reset options.</p>
                      </div>
                    </div>
                    <div className="settings-danger-actions-list">
                      <div className="settings-danger-actions">
                        <div className="danger-desc">
                          <strong>Delete all quiz data</strong>
                          <span>Permanently remove all created quizzes, questions, and drafts from this device.</span>
                        </div>
                        <button
                          type="button"
                          className="button button-danger-outline small-button"
                          onClick={() => setDataResetDialog("all")}
                        >
                          <Icon name="trash" size={14} />
                          Delete all quizzes
                        </button>
                      </div>

                      <div className="settings-danger-actions">
                        <div className="danger-desc">
                          <strong>Clear trial session history</strong>
                          <span>Clear the record of past hosted quiz sessions, participant logs, and leaderboard results.</span>
                        </div>
                        <button
                          type="button"
                          className="button button-outline small-button"
                          onClick={() => setDataResetDialog("history")}
                        >
                          Clear history ({historyRecords.length})
                        </button>
                      </div>

                      <div className="settings-danger-actions">
                        <div className="danger-desc">
                          <strong>Reset entire workspace</strong>
                          <span>Wipe all local data (quizzes, history, and preferences) for a completely fresh start.</span>
                        </div>
                        <button
                          type="button"
                          className="button button-danger small-button"
                          onClick={() => setDataResetDialog("everything")}
                        >
                          Reset everything
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {view === "waiting" && playerSession && (
        <main className="waiting-shell">
          <header className="play-header"><button type="button" className="logo-button" onClick={exitPlayerToHome}><Logo /></button><div className="playing-label"><span className="live-dot" /> CONNECTED TO ROOM</div><div className="player-chip"><span>{(fullName.trim()[0] || "G").toUpperCase()}</span>{fullName.trim() || "Guest"}</div></header>
          <section className="waiting-card">
            <div className="waiting-icon"><Icon name="clock" size={25} /></div>
            <span className="section-kicker">YOU&apos;RE IN {playerSession.title.toUpperCase()}</span>
            <h1>Hang tight, {fullName.trim().split(/\s+/)[0] || "quiz fan"}.</h1>
            <p>{playerSession.locked ? "The host has locked the room and is getting ready to start." : "The quiz hasn’t started yet. Your host will begin when everyone is ready."}</p>
            <div className="waiting-room-meta"><span><Icon name="users" size={16} /> {playerSession.participantCount} {playerSession.participantCount === 1 ? "player" : "players"} in the room</span><span>CODE <strong>{playerSession.code}</strong></span></div>
            <div className="waiting-pulse" aria-label="Waiting for host"><i /><i /><i /></div>
            <div className="waiting-footnote">
              <Icon name="sparkles" size={16} />
              <span>Stay on this screen — the first question will appear here for everyone at once.</span>
            </div>
          </section>
          <p className="play-footnote"><Icon name="globe" size={14} /> Your answers and score are sent securely to the quiz host.</p>
        </main>
      )}

      {view === "countdown" && playerSession && (
        <main className="countdown-shell">
          <header className="play-header">
            <button type="button" className="logo-button" onClick={exitPlayerToHome}><Logo /></button>
            <div className="playing-label"><span className="live-dot" /> GET READY</div>
            <div className="player-chip"><span>{(fullName.trim()[0] || "G").toUpperCase()}</span>{fullName.trim() || "Guest"}</div>
          </header>
          <section className="countdown-card">
            <div className="countdown-pill-top">
              <Icon name="lightning" size={14} /> {playerSession.questionIndex === 0 && playerSession.status === "starting" ? "QUIZ STARTING" : "NEXT QUESTION"}
            </div>
            <span className="section-kicker">{playerSession.title.toUpperCase()}</span>
            <h1>
              {playerSession.questionIndex === 0 && playerSession.status === "starting"
                ? `Get ready, ${fullName.trim().split(/\s+/)[0] || "player"}!`
                : `Question ${playerSession.questionIndex + 1} coming up!`}
            </h1>
            <p>
              {playerSession.questionIndex === 0 && playerSession.status === "starting"
                ? "Question 1 drops when the countdown hits zero. Answer fast to earn maximum bonus points!"
                : "Stay focused and trust your instincts! Faster correct answers earn more points."}
            </p>
            <div className="countdown-visual-box">
              <div className="countdown-number-pulsing" key={countdownSecondsLeft}>
                {countdownSecondsLeft > 0 ? countdownSecondsLeft : "GO!"}
              </div>
              <span className="countdown-unit-text">{countdownSecondsLeft === 1 ? "SECOND" : "SECONDS"}</span>
            </div>
            <div className="countdown-meta-row">
              <span><Icon name="crown" size={14} /> Question {playerSession.questionIndex + 1} of {playerSession.questionCount}</span>
              <span><Icon name="users" size={14} /> {playerSession.participantCount} {playerSession.participantCount === 1 ? "player" : "players"} in room</span>
            </div>
          </section>
          <p className="play-footnote"><Icon name="globe" size={14} /> Trust your instincts! Quick correct answers earn up to 1,000 points.</p>
        </main>
      )}

      {view === "countdown" && playerSession && (
        <main className="countdown-shell">
          <header className="play-header">
            <button type="button" className="logo-button" onClick={exitPlayerToHome}><Logo /></button>
            <div className="playing-label"><span className="live-dot" /> GET READY</div>
            <div className="player-chip"><span>{(fullName.trim()[0] || "G").toUpperCase()}</span>{fullName.trim() || "Guest"}</div>
          </header>
          <section className="countdown-card">
            <div className="countdown-pill-top">
              <Icon name="lightning" size={14} /> {playerSession.questionIndex === 0 && playerSession.status === "starting" ? "QUIZ STARTING" : "NEXT QUESTION"}
            </div>
            <span className="section-kicker">{playerSession.title.toUpperCase()}</span>
            <h1>
              {playerSession.questionIndex === 0 && playerSession.status === "starting"
                ? `Get ready, ${fullName.trim().split(/\s+/)[0] || "player"}!`
                : `Question ${playerSession.questionIndex + 1} coming up!`}
            </h1>
            <p>
              {playerSession.questionIndex === 0 && playerSession.status === "starting"
                ? "Question 1 drops when the countdown hits zero. Answer fast to earn maximum bonus points!"
                : "Stay focused and trust your instincts! Faster correct answers earn more points."}
            </p>
            <div className="countdown-visual-box">
              <div className="countdown-number-pulsing" key={countdownSecondsLeft}>
                {countdownSecondsLeft > 0 ? countdownSecondsLeft : "GO!"}
              </div>
              <span className="countdown-unit-text">{countdownSecondsLeft === 1 ? "SECOND" : "SECONDS"}</span>
            </div>
            <div className="countdown-meta-row">
              <span><Icon name="crown" size={14} /> Question {playerSession.questionIndex + 1} of {playerSession.questionCount}</span>
              <span><Icon name="users" size={14} /> {playerSession.participantCount} {playerSession.participantCount === 1 ? "player" : "players"} in room</span>
            </div>
          </section>
          <p className="play-footnote"><Icon name="globe" size={14} /> Trust your instincts! Quick correct answers earn up to 1,000 points.</p>
        </main>
      )}

      {view === "play" && playerSession?.question && (
        <main className="play-shell">
          <header className="play-header"><button type="button" className="logo-button" onClick={exitPlayerToHome}><Logo /></button><div className="playing-label"><span className="live-dot" /> LIVE QUIZ</div><div className="player-chip"><span>{(fullName.trim()[0] || "G").toUpperCase()}</span>{fullName.trim() || "Guest"}</div></header>
          <section className="play-content">
            <div className="play-meta"><span>{playerSession.title.toUpperCase()}</span><span className="meta-divider" /><span>QUESTION {String(playerSession.questionIndex + 1).padStart(2, "0")} OF {String(playerSession.questionCount).padStart(2, "0")}</span></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${((playerSession.questionIndex + 1) / playerSession.questionCount) * 100}%` }} /></div>
            <div className={`timer-ring${!isPlayerRevealed && playerSecondsLeft <= 5 ? " timer-warning" : ""}`}><Icon name="clock" size={17} /><strong>{isPlayerRevealed ? "00:00" : `${String(Math.floor(playerSecondsLeft / 60)).padStart(2, "0")}:${String(playerSecondsLeft % 60).padStart(2, "0")}`}</strong></div>
            {playerSession.question.imageUrl && (
              <div className="play-question-media">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={playerSession.question.imageUrl} alt="Question visual prompt" />
              </div>
            )}
            <h1 className="play-question">{playerSession.question.prompt}</h1>
            <p className="play-subtitle">
              {isPlayerRevealed
                ? (playerSession.isCorrect
                    ? `✓ Correct! You scored +${playerSession.pointsEarned ?? 0} points.`
                    : playerSession.answered
                      ? "Incorrect. The correct answer is highlighted in green below."
                      : "Time’s up! The correct answer is highlighted in green below.")
                : (playerSession.answered
                    ? "Answer submitted! Waiting for the question timer to complete."
                    : "Trust your first instinct. You’ve got this.")}
            </p>
            <div className="play-options">
              {playerSession.question.options.map((option, index) => {
                const isCorrectChoice = isPlayerRevealed && playerSession.correctIndex === index;
                const isSelected = selectedOption === index;
                const isSelectedWrong = isPlayerRevealed && isSelected && !isCorrectChoice;
                const isDimmed = isPlayerRevealed && !isCorrectChoice && !isSelected;

                let stateClass = "";
                if (isPlayerRevealed) {
                  if (isCorrectChoice) {
                    stateClass = " is-correct-answer";
                  } else if (isSelectedWrong) {
                    stateClass = " is-wrong-answer";
                  } else if (isDimmed) {
                    stateClass = " is-dimmed";
                  }
                }

                return (
                  <button
                    type="button"
                    key={`${playerSession.questionIndex}-${option}`}
                    className={`play-option play-color-${index}${isSelected ? " selected" : ""}${stateClass}${isPlayerRevealed ? " is-revealed" : ""}`}
                    onClick={() => setSelectedOption(index)}
                    disabled={playerSession.answered || isPlayerRevealed}
                    aria-pressed={isSelected}
                  >
                    <div className="play-option-inner">
                      <div className="play-option-label-group">
                        <span className="play-option-letter">{String.fromCharCode(65 + index)}</span>
                        <span className="play-option-text">{option}</span>
                      </div>
                      <div className="play-option-status-group">
                        {isPlayerRevealed ? (
                          isCorrectChoice ? (
                            <span className="play-tag-pill play-tag-correct">
                              <Icon name="check" size={13} /> {isSelected ? "You got it! Correct" : "Correct answer"}
                            </span>
                          ) : isSelectedWrong ? (
                            <span className="play-tag-pill play-tag-wrong">
                              ✕ Your pick (Incorrect)
                            </span>
                          ) : null
                        ) : isSelected ? (
                          <span className="play-tag-pill play-tag-selected">
                            <Icon name="check" size={12} /> Selected
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="play-bottom">
              <span><Icon name="lightning" size={15} /> Current score: {playerSession.score.toLocaleString()}</span>
              {!isPlayerRevealed && (
                <button type="button" className="button button-dark" onClick={submitPlayerAnswer} disabled={selectedOption === null || playerSession.answered || playerSecondsLeft === 0}>
                  {playerSession.answered ? "Answer received" : "Submit answer"} <Icon name="arrow" size={16} />
                </button>
              )}
            </div>

            {playerSession.answered && playerSession.leaderboard && playerSession.leaderboard.length > 0 && hostSettings.showLeaderboardToPlayers && (
              <div className="participant-live-leaderboard">
                <div className="participant-leaderboard-head">
                  <h3>
                    <Icon name="chart" size={15} /> Participants Standings
                  </h3>
                  <span className="participant-count-pill">
                    <Icon name="users" size={11} /> {playerSession.leaderboard.length} playing
                  </span>
                </div>
                <p className="participant-leaderboard-note">
                  {isPlayerRevealed
                    ? "Round finished · Valid scores updated with speed & accuracy points"
                    : "Your answer has been submitted! Valid current scores and standings:"}
                </p>
                <div className="participant-leaderboard-list">
                  {playerSession.leaderboard.map((item, idx) => {
                    const rank = idx + 1;
                    const isCurrent = Boolean(participantId && item.id === participantId);
                    return (
                      <div
                        key={item.id}
                        className={`participant-leaderboard-row${isCurrent ? " is-current-player" : ""}`}
                      >
                        <span className={`rank-badge${rank <= 3 ? ` rank-${rank}` : ""}`}>
                          {rank}
                        </span>
                        <span className="remaining-avatar">
                          {item.name.trim()[0]?.toUpperCase() ?? "?"}
                        </span>
                        <div className="remaining-name">
                          <strong>
                            {item.name}
                            {isCurrent && <span className="you-pill">You</span>}
                          </strong>
                          <small>
                            {!isPlayerRevealed
                              ? (item.answeredCurrent ? "Answer submitted ✓" : "Thinking…")
                              : (item.lastAnswerCorrect !== undefined
                                  ? (item.lastAnswerCorrect ? `Correct (+${item.lastAnswerPoints ?? 0} pts)` : "Incorrect (+0 pts)")
                                  : `${item.correctAnswers} correct`)}
                          </small>
                        </div>
                        <strong className="remaining-score">
                          {item.score.toLocaleString()} pts
                        </strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
          <p className="play-footnote"><Icon name="globe" size={14} /> The host controls when each question advances. Your timer is synchronized with the room.</p>
        </main>
      )}

      {view === "results" && (
        <main className="results-shell">
          <div className="results-confetti results-confetti-one" aria-hidden="true" />
          <div className="results-confetti results-confetti-two" aria-hidden="true" />
          <button type="button" className="logo-button results-logo" onClick={exitPlayerToHome}><Logo /></button>
          <section className="results-card">
            <div className="results-medal"><Icon name="crown" size={27} /></div>
            <span className="section-kicker">{playerSession?.status === "ended" ? "THAT WAS A GOOD ONE" : "QUIZ ENDED"}</span>
            <h1>Look at you go, {fullName.trim().split(/\s+/)[0] || "quiz fan"}!</h1>
            <p>{playerSession?.status === "ended" ? "You made it to the finish. Every question is a little win." : "The host has ended this quiz. Your current score is shown below."}</p>
            <div className="results-score"><strong>{playerSession?.score ?? 0}</strong><span>{playerSession?.correctAnswers ?? 0} correct<small>final points</small></span></div>
            <div className="results-progress"><span style={{ width: `${playerSession?.questionCount ? ((playerSession.correctAnswers / playerSession.questionCount) * 100) : 0}%` }} /></div>
            <div className="results-footer"><Icon name="sparkles" size={15} /> Thanks for bringing your curious mind.</div>
          </section>

          <section className="results-podium-card">
            <WinnersPodium
              participants={playerSession?.leaderboard ?? []}
              currentUserId={participantId}
              title="Winners Podium & Final Results"
              subtitle="Top 3 performers with their prizes and official final ranks for all participants."
              onPrimaryAction={exitPlayerToHome}
              primaryActionLabel="Join another quiz"
              onSecondaryAction={exitPlayerToHome}
              secondaryActionLabel="Back to home"
            />
          </section>

          <p className="play-footnote"><Icon name="globe" size={14} /> Your score is calculated by correct answers and response time.</p>
        </main>
      )}
    </>
  );
}

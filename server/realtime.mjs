import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

const sessions = new Map();
const timers = new Map();
let io = null;

function isValidCode(code) {
  return typeof code === "string" && /^\d{6}$/.test(code);
}

function generateUniqueCode(reservedCodes = []) {
  const unavailable = new Set([...sessions.keys(), ...reservedCodes.filter(isValidCode)]);
  for (let attempt = 0; attempt < 900000; attempt += 1) {
    const code = String(randomInt(100000, 1000000));
    if (!unavailable.has(code)) return code;
  }
  return null;
}

function isValidQuestions(questions) {
  return Array.isArray(questions)
    && questions.length > 0
    && questions.length <= 100
    && questions.every((question) => (
      question
      && typeof question.prompt === "string"
      && question.prompt.trim().length > 0
      && Array.isArray(question.options)
      && question.options.length === 4
      && question.options.every((option) => typeof option === "string" && option.trim().length > 0)
      && Number.isInteger(question.correctIndex)
      && question.correctIndex >= 0
      && question.correctIndex < 4
      && (question.imageUrl === undefined || typeof question.imageUrl === "string")
      && Number.isInteger(question.seconds)
      && question.seconds >= 5
      && question.seconds <= 300
    ));
}

function roomForCode(code) {
  return sessions.get(code);
}

function publicQuestion(question) {
  if (!question) return null;
  return {
    prompt: question.prompt,
    options: question.options,
    seconds: question.seconds,
    imageUrl: question.imageUrl,
  };
}

function getParticipantScore(participant, room) {
  if (room.status === "live" && room.phase === "question") {
    let score = 0;
    for (const [qIdx, ans] of Object.entries(participant.answers)) {
      if (Number(qIdx) !== room.questionIndex && ans.applied) {
        score += ans.points;
      }
    }
    return score;
  }
  return participant.score;
}

function getParticipantCorrect(participant, room) {
  if (room.status === "live" && room.phase === "question") {
    let correct = 0;
    for (const [qIdx, ans] of Object.entries(participant.answers)) {
      if (Number(qIdx) !== room.questionIndex && ans.applied) {
        if (ans.correct) correct += 1;
      }
    }
    return correct;
  }
  return participant.correctAnswers;
}

function getOptionVotes(room) {
  if (room.status !== "live" && room.status !== "ended") return [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  const qIndex = room.questionIndex;
  for (const participant of room.participants) {
    const ans = participant.answers?.[qIndex];
    if (ans && typeof ans.optionIndex === "number" && ans.optionIndex >= 0 && ans.optionIndex < 4) {
      counts[ans.optionIndex] += 1;
    }
  }
  return counts;
}

function makeHostState(room) {
  const question = (room.status === "live" && room.phase !== "countdown") ? room.questions[room.questionIndex] : null;
  const isRevealed = room.phase === "reveal" || room.status === "ended";
  const optionVotes = getOptionVotes(room);
  const totalVotes = optionVotes.reduce((sum, n) => sum + n, 0);
  const optionPercentages = optionVotes.map((v) => (totalVotes > 0 ? Math.round((v / totalVotes) * 100) : 0));
  return {
    code: room.code,
    title: room.title,
    status: room.status,
    phase: room.phase ?? (room.status === "live" ? "question" : "idle"),
    countdownEndsAt: room.countdownEndsAt ?? null,
    locked: room.locked,
    optionVotes,
    optionPercentages,
    totalVotes,
    participants: room.participants
      .map((participant) => ({
        id: participant.id,
        name: participant.name,
        score: getParticipantScore(participant, room),
        correctAnswers: getParticipantCorrect(participant, room),
        answeredCount: Object.keys(participant.answers).length,
        totalResponseMs: participant.totalResponseMs,
        connected: participant.connected,
        answeredCurrent: Object.hasOwn(participant.answers, room.questionIndex),
        lastAnswerCorrect: isRevealed && Object.hasOwn(participant.answers, room.questionIndex)
          ? Boolean(participant.answers[room.questionIndex]?.correct)
          : undefined,
        lastAnswerPoints: isRevealed && Object.hasOwn(participant.answers, room.questionIndex)
          ? participant.answers[room.questionIndex]?.points
          : undefined,
      }))
      .sort((a, b) => b.score - a.score || a.totalResponseMs - b.totalResponseMs || a.name.localeCompare(b.name)),
    questionCount: room.questions.length,
    questionIndex: room.questionIndex,
    question: question ?? null,
    questionStartedAt: room.questionStartedAt,
    questionEndsAt: room.questionEndsAt,
    serverNow: Date.now(),
  };
}

function makeParticipantState(room, participant) {
  const question = (room.status === "live" && room.phase !== "countdown") ? room.questions[room.questionIndex] : null;
  const ans = participant.answers[room.questionIndex];
  const isRevealed = room.phase === "reveal" || room.status === "ended";
  const optionVotes = getOptionVotes(room);
  const totalVotes = optionVotes.reduce((sum, n) => sum + n, 0);
  const optionPercentages = optionVotes.map((v) => (totalVotes > 0 ? Math.round((v / totalVotes) * 100) : 0));
  return {
    code: room.code,
    title: room.title,
    status: room.status,
    phase: room.phase ?? (room.status === "live" ? "question" : "idle"),
    countdownEndsAt: room.countdownEndsAt ?? null,
    locked: room.locked,
    participantName: participant.name,
    participantId: participant.id,
    score: getParticipantScore(participant, room),
    correctAnswers: getParticipantCorrect(participant, room),
    participantCount: room.participants.length,
    questionCount: room.questions.length,
    questionIndex: room.questionIndex,
    question: publicQuestion(question),
    correctIndex: isRevealed ? question?.correctIndex : undefined,
    optionVotes: isRevealed ? optionVotes : undefined,
    optionPercentages: isRevealed ? optionPercentages : undefined,
    totalVotes: isRevealed ? totalVotes : undefined,
    questionStartedAt: room.questionStartedAt,
    questionEndsAt: room.questionEndsAt,
    answered: Object.hasOwn(participant.answers, room.questionIndex),
    selectedOption: ans?.optionIndex,
    isCorrect: isRevealed && ans ? ans.correct : undefined,
    pointsEarned: isRevealed && ans ? ans.points : undefined,
    leaderboard: room.participants
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: getParticipantScore(p, room),
        correctAnswers: getParticipantCorrect(p, room),
        answeredCurrent: Object.hasOwn(p.answers, room.questionIndex),
        connected: p.connected,
        totalResponseMs: p.totalResponseMs,
        lastAnswerCorrect: isRevealed && Object.hasOwn(p.answers, room.questionIndex)
          ? Boolean(p.answers[room.questionIndex]?.correct)
          : undefined,
        lastAnswerPoints: isRevealed && Object.hasOwn(p.answers, room.questionIndex)
          ? p.answers[room.questionIndex]?.points
          : undefined,
      }))
      .sort((a, b) => b.score - a.score || a.totalResponseMs - b.totalResponseMs || a.name.localeCompare(b.name)),
    serverNow: Date.now(),
  };
}

function publishRoom(room) {
  if (room.hostSocketId) {
    io.to(room.hostSocketId).emit("host:state", makeHostState(room));
  }
  for (const participant of room.participants) {
    if (participant.socketId) {
      io.to(participant.socketId).emit("participant:state", makeParticipantState(room, participant));
    }
  }
}

function finishRoom(room) {
  clearTimeout(timers.get(room.code));
  timers.delete(room.code);
  room.status = "ended";
  room.phase = "reveal";
  room.countdownEndsAt = null;
  room.questionEndsAt = Date.now();
  for (const participant of room.participants) {
    for (const ans of Object.values(participant.answers)) {
      if (!ans.applied) {
        ans.applied = true;
        participant.score += ans.points;
        participant.correctAnswers += Number(ans.correct);
      }
    }
  }
  publishRoom(room);
}

function revealQuestion(room) {
  if (room.status !== "live" || room.phase === "reveal") return;
  clearTimeout(timers.get(room.code));
  room.phase = "reveal";
  room.questionEndsAt = Date.now();
  for (const participant of room.participants) {
    const ans = participant.answers[room.questionIndex];
    if (ans && !ans.applied) {
      ans.applied = true;
      participant.score += ans.points;
      participant.correctAnswers += Number(ans.correct);
    }
  }
  publishRoom(room);
}

function advanceQuestion(room) {
  if (room.status !== "live") return;
  clearTimeout(timers.get(room.code));
  if (room.questionIndex + 1 >= room.questions.length) {
    finishRoom(room);
    return;
  }
  startNextQuestionCountdown(room, room.questionIndex + 1);
}

function startNextQuestionCountdown(room, nextIndex) {
  clearTimeout(timers.get(room.code));
  room.status = "live";
  room.phase = "countdown";
  room.questionIndex = nextIndex;
  room.countdownStartedAt = Date.now();
  room.countdownEndsAt = room.countdownStartedAt + 3000;
  timers.set(room.code, setTimeout(() => startQuestion(room, nextIndex), 3000));
  publishRoom(room);
}

function startQuestion(room, index) {
  clearTimeout(timers.get(room.code));
  room.status = "live";
  room.phase = "question";
  room.countdownEndsAt = null;
  room.questionIndex = index;
  room.questionStartedAt = Date.now();
  room.questionEndsAt = room.questionStartedAt + room.questions[index].seconds * 1000;
  timers.set(room.code, setTimeout(() => revealQuestion(room), room.questions[index].seconds * 1000));
  publishRoom(room);
}

function startQuizCountdown(room) {
  clearTimeout(timers.get(room.code));
  room.status = "starting";
  room.phase = "countdown";
  room.questionIndex = 0;
  room.countdownStartedAt = Date.now();
  room.countdownEndsAt = room.countdownStartedAt + 5000;
  timers.set(room.code, setTimeout(() => startQuestion(room, 0), 5000));
  publishRoom(room);
}

function hostOwns(room, hostToken) {
  return room && typeof hostToken === "string" && room.hostToken === hostToken;
}

export function attachRealtime(httpServer) {
  if (io) return io;
  io = new Server(httpServer, {
    cors: {
      origin: process.env.WEB_ORIGIN?.split(",") ?? true,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
  socket.on("session:check", (code, callback) => {
    const room = isValidCode(code) ? roomForCode(code) : null;
    if (!room) {
      callback?.({ ok: false, reason: "not_started" });
      return;
    }
    if (room.status === "ended") {
      callback?.({ ok: false, reason: "ended" });
      return;
    }
    callback?.({ ok: true, status: room.status, locked: room.locked, title: room.title });
  });

  socket.on("host:create", (payload, callback) => {
    const { code, title, questions, hostToken } = payload ?? {};
    if (!isValidCode(code) || typeof title !== "string" || !title.trim() || !isValidQuestions(questions) || typeof hostToken !== "string" || hostToken.length < 20) {
      callback?.({ ok: false, error: "This quiz is missing information required to host it." });
      return;
    }

    let room = roomForCode(code);
    let assignedCode = code;
    if (room && room.hostToken !== hostToken) {
      const reservedCodes = Array.isArray(payload.reservedCodes) ? payload.reservedCodes : [];
      assignedCode = generateUniqueCode(reservedCodes);
      if (!assignedCode) {
        callback?.({ ok: false, error: "No unused quiz codes are available right now." });
        return;
      }
      room = null;
    }
    if (!room || room.status === "ended") {
      room = {
        code: assignedCode,
        title: title.trim(),
        questions,
        hostToken,
        status: "waiting",
        locked: false,
        questionIndex: -1,
        questionStartedAt: null,
        questionEndsAt: null,
        hostSocketId: socket.id,
        participants: [],
      };
      sessions.set(assignedCode, room);
    } else {
      room.hostSocketId = socket.id;
    }

    socket.join(assignedCode);
    callback?.({ ok: true, code: assignedCode });
    publishRoom(room);
  });

  socket.on("host:change-code", (payload, callback) => {
    const { code, hostToken, newCode } = payload ?? {};
    const room = roomForCode(code);
    if (!hostOwns(room, hostToken)) {
      callback?.({ ok: false, error: "Only the host can change this room code." });
      return;
    }
    if (room.status === "live") {
      callback?.({ ok: false, error: "Cannot change the code while the quiz is live." });
      return;
    }
    const nextCode = isValidCode(newCode) && !sessions.has(newCode)
      ? newCode
      : generateUniqueCode([...sessions.keys()]);
    if (!nextCode) {
      callback?.({ ok: false, error: "No available room code right now." });
      return;
    }
    sessions.delete(code);
    room.code = nextCode;
    sessions.set(nextCode, room);
    socket.leave(code);
    socket.join(nextCode);
    for (const participant of room.participants) {
      if (participant.socketId) {
        const pSocket = io.sockets.sockets.get(participant.socketId);
        if (pSocket) {
          pSocket.leave(code);
          pSocket.join(nextCode);
        }
      }
    }
    publishRoom(room);
    callback?.({ ok: true, code: nextCode });
  });

  socket.on("host:lock", (payload, callback) => {
    const room = roomForCode(payload?.code);
    if (!hostOwns(room, payload?.hostToken) || room.status !== "waiting") {
      callback?.({ ok: false, error: "The waiting room is no longer available." });
      return;
    }
    room.locked = Boolean(payload.locked);
    publishRoom(room);
    callback?.({ ok: true });
  });

  socket.on("host:start", (payload, callback) => {
    const room = roomForCode(payload?.code);
    if (!hostOwns(room, payload?.hostToken) || (room.status !== "waiting" && room.status !== "starting")) {
      callback?.({ ok: false, error: "This quiz can’t be started right now." });
      return;
    }
    if (!room.locked) {
      room.locked = true;
    }
    if (room.participants.length === 0) {
      callback?.({ ok: false, error: "At least one student must join before you start." });
      return;
    }
    for (const participant of room.participants) {
      participant.answers = {};
      participant.score = 0;
      participant.correctAnswers = 0;
      participant.totalResponseMs = 0;
    }
    startQuizCountdown(room);
    callback?.({ ok: true });
  });

  socket.on("host:end", (payload, callback) => {
    const room = roomForCode(payload?.code);
    if (!hostOwns(room, payload?.hostToken) || room.status === "ended") {
      callback?.({ ok: false, error: "This quiz has already ended." });
      return;
    }
    finishRoom(room);
    callback?.({ ok: true });
  });

  socket.on("host:next", (payload, callback) => {
    const room = roomForCode(payload?.code);
    if (!hostOwns(room, payload?.hostToken) || room.status !== "live") {
      callback?.({ ok: false, error: "Cannot advance question right now." });
      return;
    }
    if (room.phase !== "reveal") {
      revealQuestion(room);
    }
    advanceQuestion(room);
    callback?.({ ok: true });
  });

  socket.on("participant:join", (payload, callback) => {
    const { code, name, participantId } = payload ?? {};
    const room = isValidCode(code) ? roomForCode(code) : null;
    if (!room || room.status === "ended") {
      callback?.({ ok: false, reason: room ? "ended" : "not_started" });
      return;
    }
    if (room.locked && room.status === "waiting") {
      callback?.({ ok: false, reason: "locked" });
      return;
    }
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60 || typeof participantId !== "string") {
      callback?.({ ok: false, reason: "invalid" });
      return;
    }

    let participant = room.participants.find((item) => item.id === participantId);
    if (!participant) {
      participant = {
        id: participantId,
        name: name.trim(),
        score: 0,
        correctAnswers: 0,
        totalResponseMs: 0,
        connected: true,
        socketId: socket.id,
        answers: {},
      };
      room.participants.push(participant);
    } else {
      participant.name = name.trim();
      participant.connected = true;
      participant.socketId = socket.id;
    }

    socket.join(code);
    publishRoom(room);
    callback?.({ ok: true });
  });

  socket.on("participant:answer", (payload, callback) => {
    const room = roomForCode(payload?.code);
    const participant = room?.participants.find((item) => item.id === payload?.participantId && item.socketId === socket.id);
    if (!room || room.status !== "live" || room.phase === "reveal" || !participant || !Number.isInteger(payload?.optionIndex) || payload.optionIndex < 0 || payload.optionIndex > 3) {
      callback?.({ ok: false, error: "Your answer can’t be submitted right now." });
      return;
    }
    if (Date.now() > room.questionEndsAt) {
      callback?.({ ok: false, error: "Time’s up for this question." });
      return;
    }
    if (Object.hasOwn(participant.answers, room.questionIndex)) {
      callback?.({ ok: false, error: "You’ve already answered this question." });
      return;
    }

    const question = room.questions[room.questionIndex];
    const elapsedMs = Math.max(0, Math.min(Date.now() - room.questionStartedAt, question.seconds * 1000));
    const correct = payload.optionIndex === question.correctIndex;
    const speedBonus = Math.round(500 * (1 - elapsedMs / (question.seconds * 1000)));
    const points = correct ? 500 + speedBonus : 0;
    participant.answers[room.questionIndex] = {
      correct,
      points,
      elapsedMs,
      optionIndex: payload.optionIndex,
      applied: false,
    };
    participant.totalResponseMs += elapsedMs;
    callback?.({ ok: true });

    const connectedParticipants = room.participants.filter((p) => p.connected);
    const allAnswered = connectedParticipants.length > 0 && connectedParticipants.every((p) => Object.hasOwn(p.answers, room.questionIndex));
    if (allAnswered) {
      revealQuestion(room);
    } else {
      publishRoom(room);
    }
  });

  socket.on("participant:leave", (payload) => {
    const room = roomForCode(payload?.code);
    const participant = room?.participants.find((item) => item.id === payload?.participantId && item.socketId === socket.id);
    if (!room || !participant) return;
    participant.socketId = null;
    participant.connected = false;
    socket.leave(room.code);
    publishRoom(room);
  });

  socket.on("disconnect", () => {
    for (const room of sessions.values()) {
      let changed = false;
      if (room.hostSocketId === socket.id) {
        room.hostSocketId = null;
        changed = true;
      }
      for (const participant of room.participants) {
        if (participant.socketId === socket.id) {
          participant.socketId = null;
          participant.connected = false;
          changed = true;
        }
      }
      if (changed) publishRoom(room);
    }
  });
});

  return io;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, "/") === process.argv[1].replace(/\\/g, "/");
if (isMain) {
  const standalonePort = Number(process.env.REALTIME_PORT ?? process.env.PORT ?? 4001);
  const standaloneServer = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", sessions: sessions.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  attachRealtime(standaloneServer);
  standaloneServer.listen(standalonePort, "0.0.0.0", () => {
    console.log(`Quizzy standalone realtime service listening on 0.0.0.0:${standalonePort}`);
  });
}

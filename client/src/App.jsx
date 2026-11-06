import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as faceapi from 'face-api.js';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const API_BASE_URL = 'http://localhost:5000/api';

const calculateDistance = (vec1, vec2) => {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) return 1.0;
  return Math.sqrt(
    vec1.reduce((sum, val, i) => sum + Math.pow(val - Number(vec2[i]), 2), 0)
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState('scanner');
  const [facultyName] = useState('Ms. Saraswathi');
  const [facultyRole] = useState('Technical Trainer / Admin');

  const [enrolledStudents, setEnrolledStudents] = useState([]);
  const [todayAttendanceLogs, setTodayAttendanceLogs] = useState([]);
  const [stats, setStats] = useState({ totalRegistered: 0, presentToday: 0, attendanceRate: 0 });
  const [message, setMessage] = useState('');

  const [regName, setRegName] = useState('');
  const [regRollNo, setRegRollNo] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  useEffect(() => {
    const loadModelsAndData = async () => {
      try {
        setMessage('Loading biometric models...');
        const MODEL_URL = '/models';
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        setModelsLoaded(true);
        setMessage('System Ready. Mount camera to scan.');
        await syncPortalData();
      } catch (err) {
        console.error('Model loading error:', err);
        setMessage('Error loading face-api models. Ensure /public/models exist.');
      }
    };
    loadModelsAndData();
  }, []);

  const syncPortalData = async () => {
    try {
      const descRes = await axios.get(`${API_BASE_URL}/students/descriptors`);
      setEnrolledStudents(descRes.data || []);

      const todayRes = await axios.get(`${API_BASE_URL}/attendance/today`);
      setTodayAttendanceLogs(todayRes.data || []);

      const statsRes = await axios.get(`${API_BASE_URL}/attendance/stats`);
      setStats(statsRes.data || { totalRegistered: 0, presentToday: 0, attendanceRate: 0 });
    } catch (err) {
      console.error('Data Sync Error:', err);
    }
  };

  const detectAndDrawFace = async () => {
    if (!videoRef.current || !modelsLoaded) return null;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.paused || video.ended || video.readyState < 2 || video.videoWidth === 0) {
      return null;
    }

    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 320,
      scoreThreshold: 0.15
    });

    const detection = await faceapi
      .detectSingleFace(video, options)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return null;
    }

    if (canvas) {
      const displaySize = { width: video.videoWidth, height: video.videoHeight };
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      faceapi.matchDimensions(canvas, displaySize);

      const resizedDetection = faceapi.resizeResults(detection, displaySize);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      faceapi.draw.drawDetections(canvas, resizedDetection);
    }

    return Array.from(detection.descriptor);
  };

  useEffect(() => {
    let streamInstance = null;
    let intervalId = null;

    if (activeTab === 'scanner' || activeTab === 'enroll') {
      navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        .then((stream) => {
          streamInstance = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
              videoRef.current.play();
              intervalId = setInterval(() => {
                detectAndDrawFace();
              }, 150);
            };
          }
        })
        .catch((err) => {
          console.error('Camera Access Error:', err);
          setMessage('Unable to access webcam. Check browser permissions.');
        });
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (streamInstance) {
        streamInstance.getTracks().forEach((track) => track.stop());
      }
    };
  }, [activeTab, modelsLoaded]);

  const handleMarkAttendance = async () => {
    try {
      setMessage('Scanning & matching face...');
      const liveVector = await detectAndDrawFace();

      if (!liveVector) {
        setMessage('No face detected in camera frame.');
        return;
      }

      let bestMatch = null;
      let minDistance = 0.75;

      for (const student of enrolledStudents) {
        if (student.faceDescriptor && student.faceDescriptor.length === 128) {
          const dist = calculateDistance(liveVector, student.faceDescriptor);

          if (dist < minDistance) {
            minDistance = dist;
            bestMatch = student;
          }
        }
      }

      if (!bestMatch) {
        setMessage('Biometric mismatch! Face not recognized.');
        return;
      }

      const res = await axios.post(`${API_BASE_URL}/attendance/mark`, {
        rollNo: bestMatch.rollNo,
        studentId: bestMatch._id
      });

      setMessage(res.data.message || `Verified: ${bestMatch.name}`);
      await syncPortalData();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Attendance already marked today.');
    }
  };

 const handleEnrollStudent = async (e) => {
  e.preventDefault();
  if (!regName || !regRollNo) {
    alert('Please enter both Name and Roll Number.');
    return;
  }

  try {
    const descriptor = await detectAndDrawFace();

    if (!descriptor) {
      alert('No face detected. Please face the camera directly.');
      return;
    }

    // Convert Float32Array to standard array for backend JSON parsing
    const faceEmbeddingArray = Array.from(descriptor);

    const res = await axios.post(`${API_BASE_URL}/students/register`, {
      name: regName.trim(),
      rollNo: regRollNo.trim(),
      faceEmbedding: faceEmbeddingArray
    });

    if (res.status === 200 || res.status === 201) {
      // 1. Trigger dynamic green button
      setIsRegistered(true);

      // 2. Clear inputs & refresh analytics stats
      setRegName('');
      setRegRollNo('');
      await syncPortalData();

      // 3. Reset button back to blue after 3 seconds
      setTimeout(() => {
        setIsRegistered(false);
      }, 3000);
    }
  } catch (err) {
    console.error('Registration error details:', err.response?.data || err.message);
    alert(err.response?.data?.message || 'Failed to register student.');
  }
};

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Smart Attendance ERP Report', 14, 15);
    doc.setFontSize(10);
    doc.text(`Faculty / Instructor: ${facultyName}`, 14, 22);
    doc.text(`Generated On: ${new Date().toLocaleString()}`, 14, 27);

    const tableData = enrolledStudents.map((st) => {
      const checkedIn = todayAttendanceLogs.some((log) => log.rollNo === st.rollNo);
      return [
        st.rollNo,
        st.name,
        checkedIn ? 'PRESENT' : 'ABSENT',
        checkedIn ? new Date().toLocaleTimeString() : 'N/A'
      ];
    });

    autoTable(doc, {
      startY: 32,
      head: [['Roll Number', 'Student Name', 'Status', 'Time']],
      body: tableData
    });

    doc.save(`Attendance_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const totalReg = stats.totalRegistered || enrolledStudents.length || 0;
  const presentCount = stats.presentToday || 0;
  const absentees = Math.max(0, totalReg - presentCount);
  const rate = stats.attendanceRate || (totalReg > 0 ? Math.round((presentCount / totalReg) * 100) : 0);

  const pieData = [
    { name: 'Present Today', value: presentCount, color: '#10B981' },
    { name: 'Absent Today', value: absentees, color: '#EF4444' }
  ];

  return (
    <div style={{ fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif', backgroundColor: '#F3F4F6', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* HEADER */}
      <header style={{ backgroundColor: '#1E3A8A', color: '#FFF', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ backgroundColor: '#2563EB', width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '13px' }}>
            EDU
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Faculty of Engineering & Technology</h2>
            <span style={{ fontSize: '11px', color: '#93C5FD' }}>MERN Smart Attendance Portal — AIML Department</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ textAlign: 'right', fontSize: '12px' }}>
            <div style={{ fontWeight: 'bold' }}>{facultyName}</div>
            <span style={{ color: '#93C5FD', fontSize: '10px' }}>{facultyRole}</span>
          </div>
          <div style={{ width: '34px', height: '34px', borderRadius: '50%', backgroundColor: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', border: '2px solid #60A5FA', fontSize: '12px' }}>
            AD
          </div>
        </div>
      </header>

      {/* BODY LAYOUT */}
      <div style={{ display: 'flex', flex: 1 }}>
        {/* SIDEBAR */}
        <aside style={{ width: '220px', backgroundColor: '#0F172A', color: '#94A3B8', padding: '20px 12px', flexShrink: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', color: '#475569', marginBottom: '12px', paddingLeft: '8px' }}>
            MAIN MENU
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('scanner')}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px', borderRadius: '6px', border: 'none', backgroundColor: activeTab === 'scanner' ? '#2563EB' : 'transparent', color: activeTab === 'scanner' ? '#FFF' : '#94A3B8', cursor: 'pointer', textAlign: 'left', fontWeight: '500', fontSize: '13px' }}
            >
              📷 Live Scanner
            </button>

            <button
              onClick={() => setActiveTab('analytics')}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px', borderRadius: '6px', border: 'none', backgroundColor: activeTab === 'analytics' ? '#2563EB' : 'transparent', color: activeTab === 'analytics' ? '#FFF' : '#94A3B8', cursor: 'pointer', textAlign: 'left', fontWeight: '500', fontSize: '13px' }}
            >
              📊 Analytics Dashboard
            </button>

            <button
              onClick={() => setActiveTab('enroll')}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px', borderRadius: '6px', border: 'none', backgroundColor: activeTab === 'enroll' ? '#2563EB' : 'transparent', color: activeTab === 'enroll' ? '#FFF' : '#94A3B8', cursor: 'pointer', textAlign: 'left', fontWeight: '500', fontSize: '13px' }}
            >
              👤 Enroll Student
            </button>

            <button
              onClick={() => setActiveTab('export')}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px', borderRadius: '6px', border: 'none', backgroundColor: activeTab === 'export' ? '#2563EB' : 'transparent', color: activeTab === 'export' ? '#FFF' : '#94A3B8', cursor: 'pointer', textAlign: 'left', fontWeight: '500', fontSize: '13px' }}
            >
              📄 Export Reports
            </button>
          </nav>
        </aside>

        {/* MAIN CONTAINER */}
        <main style={{ flex: 1, padding: '20px 28px', backgroundColor: '#F8FAFC' }}>
          {/* STAT CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
            <div style={{ backgroundColor: '#FFF', padding: '14px 18px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid #2563EB' }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#64748B', textTransform: 'uppercase' }}>TOTAL REGISTERED</div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#0F172A', marginTop: '4px' }}>{totalReg}</div>
            </div>

            <div style={{ backgroundColor: '#FFF', padding: '14px 18px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid #10B981' }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#64748B', textTransform: 'uppercase' }}>PRESENT TODAY</div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#10B981', marginTop: '4px' }}>{presentCount}</div>
            </div>

            <div style={{ backgroundColor: '#FFF', padding: '14px 18px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid #F59E0B' }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#64748B', textTransform: 'uppercase' }}>ATTENDANCE RATE</div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#D97706', marginTop: '4px' }}>{rate}%</div>
            </div>

            <div style={{ backgroundColor: '#FFF', padding: '14px 18px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid #EF4444' }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#64748B', textTransform: 'uppercase' }}>ABSENTEE COUNT</div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#EF4444', marginTop: '4px' }}>{absentees}</div>
            </div>
          </div>

          {/* TAB: LIVE SCANNER */}
          {activeTab === 'scanner' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px', alignItems: 'start' }}>
              <div style={{ backgroundColor: '#FFF', padding: '18px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', textAlign: 'center' }}>
                <div style={{ position: 'relative', width: '100%', maxHeight: '460px', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <video ref={videoRef} autoPlay muted style={{ width: '100%', height: 'auto', maxHeight: '460px', objectFit: 'cover', display: 'block' }} />
                  <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
                  <button
                    onClick={handleMarkAttendance}
                    style={{ backgroundColor: '#10B981', color: '#FFF', padding: '10px 24px', fontSize: '14px', fontWeight: 'bold', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Verify & Mark Attendance
                  </button>

                  {message && (
                    <div style={{ padding: '8px 14px', backgroundColor: '#F1F5F9', borderRadius: '6px', fontSize: '12px', color: '#334155', fontWeight: '500' }}>
                      {message}
                    </div>
                  )}
                </div>
              </div>

              {/* ROSTER */}
              <div style={{ backgroundColor: '#FFF', padding: '18px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <h3 style={{ margin: '0 0 14px 0', fontSize: '15px', color: '#1E293B' }}>Class Status Roster</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '480px', overflowY: 'auto' }}>
                  {enrolledStudents.length === 0 ? (
                    <div style={{ fontSize: '13px', color: '#94A3B8', textAlign: 'center', padding: '20px 0' }}>No students enrolled.</div>
                  ) : (
                    enrolledStudents.map((student) => {
                      const isPresent = todayAttendanceLogs.some((log) => log.rollNo === student.rollNo);
                      return (
                        <div
                          key={student._id || student.rollNo}
                          style={{
                            padding: '10px 12px',
                            borderRadius: '6px',
                            backgroundColor: isPresent ? '#ECFDF5' : '#FEF2F2',
                            border: `1px solid ${isPresent ? '#A7F3D0' : '#FCA5A5'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#0F172A' }}>{student.name}</div>
                            <div style={{ fontSize: '11px', color: '#64748B' }}>{student.rollNo}</div>
                          </div>
                          <span style={{ fontSize: '10px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '4px', backgroundColor: isPresent ? '#10B981' : '#EF4444', color: '#FFF' }}>
                            {isPresent ? 'PRESENT' : 'ABSENT'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB: ANALYTICS */}
          {activeTab === 'analytics' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div style={{ backgroundColor: '#FFF', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#1E293B' }}>Daily Attendance Breakdown</h3>
                <div style={{ width: '100%', height: 320 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{ backgroundColor: '#FFF', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#1E293B' }}>Enrolled Students Ratio</h3>
                <div style={{ width: '100%', height: 320 }}>
                  <ResponsiveContainer>
                    <BarChart data={[{ name: 'Class Roster', Present: presentCount, Absent: absentees }]}>
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="Present" fill="#10B981" />
                      <Bar dataKey="Absent" fill="#EF4444" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* TAB: ENROLL */}
          {activeTab === 'enroll' && (
            <div style={{ backgroundColor: '#FFF', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', maxWidth: '580px', margin: '0 auto' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#0F172A' }}>Enroll New Student Descriptor</h3>

              <form onSubmit={handleEnrollStudent} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>Full Name</label>
                  <input
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="e.g. G.Bhuvaneshwari"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>Roll Number</label>
                  <input
                    type="text"
                    value={regRollNo}
                    onChange={(e) => setRegRollNo(e.target.value)}
                    placeholder="e.g. 310624148013"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', boxSizing: 'border-box', fontSize: '13px' }}
                  />
                </div>

                <div style={{ position: 'relative', width: '100%', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden' }}>
                  <video ref={videoRef} autoPlay muted style={{ width: '100%', height: 'auto', display: 'block' }} />
                  <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                </div>

                <button
                    type="submit"
                    onClick={handleEnrollStudent}
                    style={{
                    width: '100%',
                    padding: '12px 20px',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    color: '#ffffff',
                    backgroundColor: isRegistered ? '#10B981' : '#2563EB', // #10B981 is Solid Green, #2563EB is Blue
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.3s ease',
    marginTop: '15px'
  }}
>
  {isRegistered ? "✓ Successfully Registered!" : "Capture & Register Face"}
</button>
              </form>
            </div>
          )}

          {/* TAB: EXPORT */}
          {activeTab === 'export' && (
            <div style={{ backgroundColor: '#FFF', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#0F172A' }}>Export Official Attendance PDF</h3>
              <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '18px' }}>
                Download a formatted PDF summary of today's biometric attendance logs for departmental archives.
              </p>

              <button
                onClick={handleExportPDF}
                style={{ backgroundColor: '#10B981', color: '#FFF', padding: '10px 22px', fontSize: '14px', fontWeight: 'bold', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
              >
                📄 Download PDF Report
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
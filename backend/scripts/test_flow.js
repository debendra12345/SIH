const http = require('http');

const request = (path, method = 'GET', body = null) => {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://localhost:5001');
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

const runTests = async () => {
  console.log('====================================================');
  console.log('🩺 MediKiosk End-to-End Database & API Test Suite');
  console.log('====================================================\n');

  let patientId = null;

  // 1. Register patient
  console.log('▶ Step 1 & 2 & 3: Register new patient and verify generated ID...');
  const regRes = await request('/api/patients/register', 'POST', {
    name: 'Ananya Verma',
    phone: '9811223344',
    dateOfBirth: '1996-08-15',
    gender: 'Female',
    age: 30,
    bloodGroup: 'A+',
    email: 'ananya.verma@example.com',
    address: 'Flat 204, Green Park, New Delhi',
    department: 'Cardiology',
    room: 'Room 2'
  });

  if (regRes.status !== 201 || !regRes.data.success || !regRes.data.patientId) {
    throw new Error(`Failed to register patient: ${JSON.stringify(regRes)}`);
  }
  patientId = regRes.data.patientId;
  console.log(`✅ Patient registered successfully with Generated ID: ${patientId}, Token: ${regRes.data.session.opdToken}`);

  // 4. Submit Health History
  console.log('\n▶ Step 4: Submit health history for ' + patientId + '...');
  const hhRes = await request(`/api/patients/${patientId}/health-history`, 'POST', {
    chiefComplaint: 'Palpitations and breathlessness on moderate exertion since 4 days',
    symptoms: ['Palpitations', 'Breathlessness', 'Fatigue'],
    symptomDuration: '4 days',
    severity: 'High',
    severityNum: 8,
    medicalHistory: ['Mild Asthma', 'Allergic Rhinitis'],
    currentMedications: ['Levocetirizine 5mg', 'Salbutamol Inhaler SOS'],
    allergies: ['Dust', 'Pollen', 'Penicillin'],
    familyHistory: ['Mother: Hypertension'],
    additionalNotes: 'Episodes happen predominantly in the evening.'
  });

  if (hhRes.status !== 201 || !hhRes.data.success) {
    throw new Error(`Failed to submit health history: ${JSON.stringify(hhRes)}`);
  }
  console.log('✅ Health history stored in database: ' + hhRes.data.data.chiefComplaint);

  // 5. Submit AYUSH History
  console.log('\n▶ Step 5: Submit AYUSH history for ' + patientId + '...');
  const ayRes = await request(`/api/patients/${patientId}/ayush-history`, 'POST', {
    ayushTreatment: 'Ayurveda & Yoga Therapy',
    prakriti: 'Vata-Pitta',
    agni: 'Tikshnagni (Intense / Acidity)',
    diet: 'Vegetarian',
    sleep: 'Disturbed / Frequent waking',
    stress: 'High stress / Work anxiety',
    medicines: ['Brahmi Vati', 'Ashwagandha Churna', 'Anu Taila Nasya'],
    practitioner: 'Dr. Vaidya Joshi (Naturopathy)',
    duration: '2 months',
    otherInfo: 'Practices Anulom Vilom Pranayama daily'
  });

  if (ayRes.status !== 201 || !ayRes.data.success) {
    throw new Error(`Failed to submit AYUSH history: ${JSON.stringify(ayRes)}`);
  }
  console.log(`✅ AYUSH history stored in database: Prakriti = ${ayRes.data.data.prakriti}, Agni = ${ayRes.data.data.agni}`);

  // 6. Add Previous Medical Records Metadata & OCR
  console.log('\n▶ Step 6: Add previous medical record metadata & OCR extraction for ' + patientId + '...');
  const recRes = await request(`/api/patients/${patientId}/records`, 'POST', {
    recordType: 'prescription',
    fileName: 'Previous_Cardiology_Prescription.pdf',
    filePath: '/uploads/ananya_rx_1.pdf',
    extractedText: 'Rx Metoprolol 25mg OD, Montelukast 10mg HS. Dr. S. Rao.',
    structuredData: {
      prescribedMedicines: ['Metoprolol 25mg', 'Montelukast 10mg'],
      doctor: 'Dr. S. Rao',
      clinic: 'Apex Heart Centre'
    },
    confidence: 0.99
  });

  if (recRes.status !== 201 || !recRes.data.success) {
    throw new Error(`Failed to save record: ${JSON.stringify(recRes)}`);
  }
  console.log('✅ Medical record & OCR data stored in database: ' + recRes.data.data.fileName);

  // 7. Create/Retrieve Clinical Summary
  console.log('\n▶ Step 7: Create & retrieve clinical summary for ' + patientId + '...');
  const sumRes = await request(`/api/patients/${patientId}/summary`, 'POST', {
    summary: '30yo female presenting with 4-day history of exertional palpitations and breathlessness. History of mild asthma. AYUSH profile shows Vata-Pitta with high stress. Previous prescription shows Metoprolol 25mg. Priority: High.',
    status: 'generated'
  });

  if (sumRes.status !== 201 || !sumRes.data.success) {
    throw new Error(`Failed to create summary: ${JSON.stringify(sumRes)}`);
  }
  console.log('✅ Clinical summary generated and synced: ' + sumRes.data.data.summary.substring(0, 60) + '...');

  // 8. Doctor Login
  console.log('\n▶ Step 8: Doctor sign in via /api/auth/doctor/login...');
  const authRes = await request('/api/auth/doctor/login', 'POST', {
    doctorId: 'DOC-1042',
    password: 'demo123'
  });

  if (authRes.status !== 200 || !authRes.data.doctor) {
    throw new Error(`Doctor login failed: ${JSON.stringify(authRes)}`);
  }
  console.log(`✅ Doctor authenticated: ${authRes.data.doctor.name} (${authRes.data.doctor.doctorId})`);

  // 9 & 10. Doctor Queue & Search Patient by ID
  console.log('\n▶ Step 9 & 10: Doctor queries queue and retrieves full dossier for ' + patientId + '...');
  const queueRes = await request('/api/doctor/patients', 'GET');
  if (queueRes.status !== 200 || !Array.isArray(queueRes.data.data)) {
    throw new Error(`Failed to get doctor queue: ${JSON.stringify(queueRes)}`);
  }
  const foundInQueue = queueRes.data.data.find(p => p.id === patientId);
  if (!foundInQueue) {
    throw new Error(`Patient ${patientId} not found in doctor OPD queue!`);
  }
  console.log(`✅ Patient ${patientId} found in Doctor OPD Queue (Status: ${foundInQueue.status}, Token: ${foundInQueue.token})`);

  const dossierRes = await request(`/api/doctor/patients/${patientId}`, 'GET');
  if (dossierRes.status !== 200 || !dossierRes.data.data) {
    throw new Error(`Failed to get dossier for ${patientId}: ${JSON.stringify(dossierRes)}`);
  }

  const dossier = dossierRes.data.data;
  console.log('✅ Verified Full Patient Dossier retrieved from database:');
  console.log(`   • Patient Name: ${dossier.patient.name}`);
  console.log(`   • OPD Token: ${dossier.session.opdToken} (${dossier.session.department})`);
  console.log(`   • Chief Complaint: ${dossier.healthHistory.chiefComplaint}`);
  console.log(`   • AYUSH Prakriti: ${dossier.ayushHistory.prakriti}`);
  console.log(`   • Records Count: ${dossier.previousRecords.length}`);
  console.log(`   • Clinical Summary: ${dossier.clinicalSummary.summary ? 'Available' : 'None'}`);

  // 11 & 12. Add Doctor Review
  console.log('\n▶ Step 11 & 12: Doctor adds clinical review & signs summary...');
  const revRes = await request(`/api/doctor/patients/${patientId}/review`, 'POST', {
    doctorId: 'DOC-1042',
    notes: 'Reviewed ECG & Vitals. Sinus tachycardia noted on exertion. Advised 24-hr Holter monitoring, 2D Echo, and continued Pranayama with Metoprolol titration. Follow up in 1 week.',
    reviewStatus: 'reviewed'
  });

  if (revRes.status !== 201 || !revRes.data.success) {
    throw new Error(`Failed to add doctor review: ${JSON.stringify(revRes)}`);
  }
  console.log(`✅ Doctor review stored in database (Review ID: ${revRes.data.data.reviewId})`);

  // 13. Retrieve Patient again & verify review appears
  console.log('\n▶ Step 13: Retrieve patient dossier again and verify review appears...');
  const finalDossierRes = await request(`/api/doctor/patients/${patientId}`, 'GET');
  const finalDossier = finalDossierRes.data.data;
  if (!finalDossier.doctorReviews || finalDossier.doctorReviews.length === 0) {
    throw new Error('Doctor review did not appear in final patient dossier!');
  }
  console.log(`✅ Verified doctor review is present in patient dossier (Total Reviews: ${finalDossier.doctorReviews.length})`);
  console.log(`   • Reviewer: ${finalDossier.doctorReviews[0].doctorName}`);
  console.log(`   • Review Notes: ${finalDossier.doctorReviews[0].notes.substring(0, 50)}...`);
  console.log(`   • Session Status: ${finalDossier.session.status}`);

  // 14. Validation & Error Handling Tests
  console.log('\n▶ Step 14: Testing validation & edge cases (Invalid IDs, missing fields)...');
  const invalidPatient = await request('/api/doctor/patients/P-999999', 'GET');
  if (invalidPatient.status !== 404) {
    throw new Error(`Expected 404 for non-existent patient, got ${invalidPatient.status}`);
  }
  console.log('✅ Non-existent Patient ID correctly returned 404');

  const invalidReg = await request('/api/patients/register', 'POST', {});
  if (invalidReg.status !== 400) {
    throw new Error(`Expected 400 for empty registration, got ${invalidReg.status}`);
  }
  console.log('✅ Empty registration correctly returned 400 Bad Request');

  console.log('\n====================================================');
  console.log('🎉 ALL 13 TEST CASES PASSED SUCCESSFULLY!');
  console.log('====================================================');
};

runTests().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});

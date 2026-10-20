function calculateEuclideanDistance(vecA, vecB) {
  let sum = 0;
  for (let i = 0; i < vecA.length; i++) {
    sum += Math.pow(vecA[i] - vecB[i], 2);
  }
  return Math.sqrt(sum);
}

function findBestMatch(scannedEmbedding, students, threshold = 0.6) {
  let bestMatch = null;
  let minDistance = Infinity;

  for (const student of students) {
    if (!student.faceEmbedding || student.faceEmbedding.length !== 128) continue;
    const distance = calculateEuclideanDistance(scannedEmbedding, student.faceEmbedding);
    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = student;
    }
  }

  return minDistance <= threshold ? { student: bestMatch, distance: minDistance } : null;
}

module.exports = { calculateEuclideanDistance, findBestMatch };
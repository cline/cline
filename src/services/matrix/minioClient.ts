import { Client } from "minio"

// MinIO configuration
const minioConfig = {
	endPoint: process.env.MINIO_ENDPOINT || "localhost",
	port: parseInt(process.env.MINIO_PORT || "9000", 10),
	useSSL: process.env.MINIO_USE_SSL === "true",
	accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
	secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
}

// Create a MinIO client instance
export const minioClient = new Client(minioConfig)

// Bucket name for storing processed matrix files
export const MATRIX_FILES_BUCKET = process.env.MINIO_MATRIX_BUCKET || "matrix-files"

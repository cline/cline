import { Client } from "minio"

// MinIO configuration
export const minioConfig = {
	endPoint: process.env.MINIO_ENDPOINT || "172.16.10.218",
	port: parseInt(process.env.MINIO_PORT || "9000", 10),
	useSSL: process.env.MINIO_USE_SSL === "false",
	accessKey: process.env.MINIO_ACCESS_KEY || "QRv8bNywHhKrXs7AIQj8",
	secretKey: process.env.MINIO_SECRET_KEY || "qBOYvl4QysF1TYl00AyRQF0pO1cgL9SN92cY1isd",
}

// Create a MinIO client instance
export const minioClient = new Client(minioConfig)

// Bucket name for storing processed matrix files
export const MATRIX_FILES_BUCKET = process.env.MINIO_MATRIX_BUCKET || "cline-can-files"

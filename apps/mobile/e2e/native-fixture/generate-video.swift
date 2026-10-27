// xcrun swift generate-video.swift /absolute/path/fixture-video.mp4
import AVFoundation
import CoreVideo
import Foundation

let path = CommandLine.arguments[1]
let output = URL(fileURLWithPath:path)
let writer = try AVAssetWriter(outputURL:output, fileType:.mp4)
let input = AVAssetWriterInput(mediaType:.video, outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264, AVVideoWidthKey:160, AVVideoHeightKey:90])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:input,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32ARGB,kCVPixelBufferWidthKey as String:160,kCVPixelBufferHeightKey as String:90])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime:.zero)
for index in 0..<50 {
 while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval:0.01) }
 var buffer:CVPixelBuffer?
 CVPixelBufferCreate(kCFAllocatorDefault,160,90,kCVPixelFormatType_32ARGB,nil,&buffer)
 guard let buffer else { fatalError("Pixel buffer unavailable") }
 CVPixelBufferLockBaseAddress(buffer,[])
 if let address=CVPixelBufferGetBaseAddress(buffer) {
  let row=CVPixelBufferGetBytesPerRow(buffer)
  for y in 0..<90 { for x in 0..<160 {
   let p=address.advanced(by:y*row+x*4).assumingMemoryBound(to:UInt8.self)
   p[0]=255;p[1]=UInt8((index*10)%256);p[2]=UInt8(x);p[3]=UInt8(y*2)
  } }
 }
 CVPixelBufferUnlockBaseAddress(buffer,[])
 if !adaptor.append(buffer,withPresentationTime:CMTime(value:Int64(index),timescale:10)) { fatalError("Append failed: \(String(describing:writer.error))") }
}
input.markAsFinished()
let finished=DispatchSemaphore(value:0)
writer.finishWriting { finished.signal() }
finished.wait()
guard writer.status == .completed else { fatalError("Video writer failed: \(String(describing:writer.error))") }
print(path)

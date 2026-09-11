// Background removal for product photography, using Vision's
// foreground-instance mask — the same engine behind "Copy Subject" in
// Preview and Photos. Runs entirely on this machine: no model download,
// no upload to a third party, no per-image cost.
//
//   swiftc -O bgremove.swift -o bgremove
//   ./bgremove <out_dir> <image>...
//
// Writes <out_dir>/<basename>.png with a transparent background. Exits
// non-zero if any image failed, and names which.
//
// Requires macOS 14 or later for VNGenerateForegroundInstanceMaskRequest.
//
// It segments a photographed subject. It has no idea what to do with
// line art on a flat background — a logo used as a placeholder, say —
// and fails cleanly on those rather than guessing; key the white out of
// those separately. Always run bgremove-check.py afterwards: a white bag
// on a white ground looks identical whether or not the background came
// away, so only the alpha channel can tell you it worked.

import Foundation
import Vision
import CoreImage
import AppKit

struct Failure: Error, CustomStringConvertible {
    let description: String
}

let ciContext = CIContext()

func removeBackground(input: URL, output: URL) throws {
    let handler = VNImageRequestHandler(url: input, options: [:])
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])

    guard let observation = request.results?.first else {
        throw Failure(description: "no foreground subject detected")
    }

    let masked = try observation.generateMaskedImage(
        ofInstances: observation.allInstances,
        from: handler,
        croppedToInstancesExtent: false
    )

    let image = CIImage(cvPixelBuffer: masked)
    guard let space = CGColorSpace(name: CGColorSpace.sRGB) else {
        throw Failure(description: "no sRGB colour space")
    }
    try ciContext.writePNGRepresentation(
        of: image, to: output, format: .RGBA8, colorSpace: space
    )
}

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: bgremove <out_dir> <image>...\n".data(using: .utf8)!)
    exit(2)
}

let outDir = URL(fileURLWithPath: args[1], isDirectory: true)
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

var failed = 0
for path in args.dropFirst(2) {
    let input = URL(fileURLWithPath: path)
    let output = outDir.appendingPathComponent(
        input.deletingPathExtension().lastPathComponent + ".png")
    do {
        try removeBackground(input: input, output: output)
        let size = (try? FileManager.default.attributesOfItem(atPath: output.path)[.size]) as? Int ?? 0
        print("ok    \(input.lastPathComponent) -> \(output.lastPathComponent) (\(size) bytes)")
    } catch {
        failed += 1
        print("FAIL  \(input.lastPathComponent): \(error)")
    }
}
exit(failed == 0 ? 0 : 1)

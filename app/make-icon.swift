// Draws the 1024×1024 app icon: usage `swift make-icon.swift out.png`
// Four file-type tiles (sheet, document, JSON, video) on a slate squircle, matching the in-app logo.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024.0
let ctx = CGContext(data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}
func rounded(_ r: CGRect, _ radius: CGFloat) -> CGPath {
    CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

let body = CGRect(x: 100, y: 100, width: 824, height: 824)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: rgb(0x000000, 0.3))
ctx.addPath(rounded(body, 185)); ctx.setFillColor(rgb(0x1B2530)); ctx.fillPath()
ctx.restoreGState()
ctx.saveGState()
ctx.addPath(rounded(body, 185)); ctx.clip()
let gradient = CGGradient(colorsSpace: nil, colors: [rgb(0x2C3A48), rgb(0x18212B)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 924), end: CGPoint(x: 0, y: 100), options: [])
ctx.restoreGState()

// tiles: top-left CSV (green), top-right DOC (blue), bottom-left JSON (amber), bottom-right video (plum)
let tile = 300.0, gap = 44.0
let x0 = (size - tile * 2 - gap) / 2, y0 = x0
let colors: [UInt32] = [0x0F7B5F, 0x2B59C3, 0xA96500, 0x8A3FA0]
for (i, color) in colors.enumerated() {
    let col = Double(i % 2), row = Double(1 - i / 2)
    let r = CGRect(x: x0 + col * (tile + gap), y: y0 + row * (tile + gap), width: tile, height: tile)
    ctx.addPath(rounded(r, 56)); ctx.setFillColor(rgb(color)); ctx.fillPath()
    ctx.setFillColor(rgb(0xFFFFFF, 0.9))
    switch i {
    case 0: // grid
        for gx in 0..<3 { for gy in 0..<3 {
            ctx.addPath(rounded(CGRect(x: r.minX + 52 + Double(gx) * 68, y: r.minY + 52 + Double(gy) * 68, width: 56, height: 56), 10)); ctx.fillPath()
        } }
    case 1: // text lines
        for (n, w) in [196.0, 160, 196, 120].enumerated() {
            ctx.addPath(rounded(CGRect(x: r.minX + 52, y: r.maxY - 82 - Double(n) * 50, width: w, height: 24), 12)); ctx.fillPath()
        }
    case 2: // braces
        ctx.setStrokeColor(rgb(0xFFFFFF, 0.92)); ctx.setLineWidth(26); ctx.setLineCap(.round); ctx.setLineJoin(.round)
        for s in [-1.0, 1.0] {
            let cx = r.midX + s * 62
            ctx.move(to: CGPoint(x: cx + s * 18, y: r.maxY - 70))
            ctx.addLine(to: CGPoint(x: cx, y: r.maxY - 90))
            ctx.addLine(to: CGPoint(x: cx, y: r.midY + 22))
            ctx.addLine(to: CGPoint(x: cx - s * 24, y: r.midY))
            ctx.addLine(to: CGPoint(x: cx, y: r.midY - 22))
            ctx.addLine(to: CGPoint(x: cx, y: r.minY + 90))
            ctx.addLine(to: CGPoint(x: cx + s * 18, y: r.minY + 70))
        }
        ctx.strokePath()
    default: // play triangle
        ctx.move(to: CGPoint(x: r.midX - 52, y: r.midY + 76))
        ctx.addLine(to: CGPoint(x: r.midX + 78, y: r.midY))
        ctx.addLine(to: CGPoint(x: r.midX - 52, y: r.midY - 76))
        ctx.closePath(); ctx.fillPath()
    }
}

let out = URL(fileURLWithPath: CommandLine.arguments[1])
let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
CGImageDestinationFinalize(dest)

import { describe, expect, it } from "vitest"
import {
  attachmentsFromParts,
  decodeBinaryPart,
  embedCidImages,
  headerField,
  htmlToText,
  normalizeCid,
  parseAddressHeader,
  toSnippet
} from "./parse"

describe("headerField", () => {
  it("抽取字段并展开折行", () => {
    const raw = "Subject: hello\r\n\tworld\r\nTo: a@b.com\r\n"
    expect(headerField(raw, "subject")).toBe("hello world")
    expect(headerField(raw, "To")).toBe("a@b.com")
    expect(headerField(raw, "missing")).toBe("")
  })
})

describe("parseAddressHeader", () => {
  it("解码 RFC2047 姓名并保留地址", () => {
    expect(parseAddressHeader("=?UTF-8?B?5byg5LiJ?= <zhang@example.com>, li@example.com")).toEqual([
      { name: "张三", address: "zhang@example.com" },
      { name: "", address: "li@example.com" }
    ])
  })

  it("引号里的逗号不算分隔符", () => {
    expect(parseAddressHeader('"Doe, John" <john@example.com>')).toEqual([
      { name: "Doe, John", address: "john@example.com" }
    ])
  })
})

describe("normalizeCid", () => {
  it("去掉尖括号与空白", () => {
    expect(normalizeCid("  <abc@x> ")).toBe("abc@x")
    expect(normalizeCid("abc@x")).toBe("abc@x")
  })
})

describe("toSnippet", () => {
  it("去标签、压空白并按长度截断", () => {
    expect(toSnippet("<p>hello <b>world</b></p>\r\n<p>second</p>")).toBe("hello world second")
    expect(toSnippet("a".repeat(10), 5)).toBe("aaaaa…")
  })
})

describe("attachmentsFromParts", () => {
  it("base64 尺寸按行折算（40MB 不再显示成 41.1MB）", () => {    const [attachment] = attachmentsFromParts(
      [{ part: "2", filename: "a.bin", mime: "application/octet-stream", encoding: "base64", size: 1000 }],
      "msg-1"
    )
    // ceil(1000/78)=13 行，每行折掉 2 字节 CRLF：(1000-26)*3/4 = 730.5 → 731
    expect(attachment.size).toBe(731)
    expect(attachment.part).toBe("2")
    expect(attachment.messageId).toBe("msg-1")
  })

  it("非 base64 不折算", () => {
    const [attachment] = attachmentsFromParts(
      [{ part: "3", filename: "b.txt", mime: "text/plain", encoding: "7bit", size: 1000 }],
      "msg-1"
    )
    expect(attachment.size).toBe(1000)
  })
})

describe("htmlToText", () => {
  it("把 br / p 变成换行并去掉标签", () => {
    expect(htmlToText("<p>第一段</p><p>第二段<br>换行</p>")).toBe("第一段\n\n第二段\n换行")
  })

  it("没有 text/plain 时才用，去标签后保留原文空格", () => {
    expect(htmlToText("<div>  a  b  </div>")).toBe("a  b")
  })
})

describe("embedCidImages", () => {
  it("按 content-id（忽略大小写与尖括号）替换 cid 引用", () => {
    const html = '<img src="cid:Img@X"><img src="cid:missing@x">'
    const out = embedCidImages(html, new Map([["img@x", "data:image/png;base64,AAA"]]))
    expect(out).toBe('<img src="data:image/png;base64,AAA"><img src="cid:missing@x">')
  })

  it("没有 cid 引用时原样返回", () => {
    const html = "<p>plain</p>"
    expect(embedCidImages(html, new Map([["a", "data:"] ]))).toBe(html)
  })
})

describe("decodeBinaryPart", () => {
  it("base64 忽略换行", () => {
    const encoded = Buffer.from("hello", "utf8").toString("base64")
    const wrapped = encoded.slice(0, 4) + "\r\n" + encoded.slice(4)
    expect(decodeBinaryPart(Buffer.from(wrapped, "ascii"), "base64").toString("utf8")).toBe("hello")
  })

  it("quoted-printable 还原 =XX 与软换行", () => {
    const raw = Buffer.from("hello=3Dworld=\r\n!", "latin1")
    expect(decodeBinaryPart(raw, "quoted-printable").toString("utf8")).toBe("hello=world!")
  })
})
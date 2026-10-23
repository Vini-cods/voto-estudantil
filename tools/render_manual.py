"""Render docs/LEIA-ME.html to the distributed PDF (ReportLab required)."""
from html.parser import HTMLParser
from pathlib import Path
import re
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

ROOT = Path(__file__).resolve().parents[1]
class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []
    def cls(self, name): return name in self.attrs.get('class', '').split()
    def text(self): return ''.join(c.text() if isinstance(c, Node) else c for c in self.children)
    def find(self, tag):
        for child in self.children:
            if isinstance(child, Node):
                if child.tag == tag: return child
                result = child.find(tag)
                if result: return result
    def all(self, tag):
        result=[]
        for child in self.children:
            if isinstance(child,Node):
                if child.tag == tag: result.append(child)
                else: result.extend(child.all(tag))
        return result
class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.root=Node(); self.stack=[self.root]
    def handle_starttag(self,tag,attrs):
        node=Node(tag,attrs); self.stack[-1].children.append(node)
        if tag not in ('br','meta','link','img','input','hr'): self.stack.append(node)
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag==tag:
                del self.stack[i:]; break
    def handle_data(self,data): self.stack[-1].children.append(data)
    def handle_entityref(self,name): self.stack[-1].children.append('&'+name+';')
    def handle_charref(self,name): self.stack[-1].children.append('&#'+name+';')

def rich(node):
    if isinstance(node,str): return node.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
    content=''.join(rich(c) for c in node.children)
    if node.tag in ('b','strong'): return '<b>'+content+'</b>'
    if node.tag in ('i','em'): return '<i>'+content+'</i>'
    if node.tag=='br': return '<br/>'
    if node.tag=='code': return '<font name="Courier" size="8.3">'+content+'</font>'
    if node.tag=='a': return content
    return content

def main():
    font_dir=Path('C:/Windows/Fonts')
    if (font_dir/'segoeui.ttf').exists():
        for name,file in [('Manual','segoeui.ttf'),('ManualBold','segoeuib.ttf'),('ManualItalic','segoeuii.ttf'),('ManualBoldItalic','segoeuiz.ttf')]:
            pdfmetrics.registerFont(TTFont(name,str(font_dir/file)))
        pdfmetrics.registerFontFamily('Manual',normal='Manual',bold='ManualBold',italic='ManualItalic',boldItalic='ManualBoldItalic')
        font='Manual'
    else: font='Helvetica'
    ink=colors.HexColor('#172936'); green=colors.HexColor('#08644c'); line=colors.HexColor('#d7e1e5')
    body=ParagraphStyle('Body',fontName=font,fontSize=9.25,leading=12.4,textColor=ink,spaceAfter=7)
    lead=ParagraphStyle('Lead',parent=body,fontSize=10,leading=13.6,textColor=colors.HexColor('#536570'),spaceAfter=10)
    heading=ParagraphStyle('Heading',parent=body,fontSize=22,leading=26,spaceAfter=14)
    h2=ParagraphStyle('H2',parent=body,fontSize=13,leading=16,spaceBefore=9,spaceAfter=7,keepWithNext=True)
    h3=ParagraphStyle('H3',parent=h2,fontSize=10,leading=13,spaceBefore=5)
    small=ParagraphStyle('Small',parent=body,fontSize=8.25,leading=11)
    item=ParagraphStyle('Item',parent=body,leftIndent=16,firstLineIndent=-14,spaceAfter=6)
    cell=ParagraphStyle('Cell',parent=body,fontSize=8.3,leading=11,spaceAfter=0)
    eyebrow=ParagraphStyle('Eyebrow',parent=small,textColor=green,fontSize=8,leading=10,spaceAfter=7)
    parser=Parser();parser.feed((ROOT/'docs/LEIA-ME.html').read_text(encoding='utf-8'))
    pages=[p for p in parser.root.all('section') if p.cls('page')]
    story=[]
    for page_index,page in enumerate(pages):
        if page_index: story.append(PageBreak())
        header=page.find('header')
        story.extend([Paragraph('GUIA DE USO  /  VOZ DA ESCOLA 2.0',eyebrow),Paragraph(rich(header.find('h1')),heading)])
        def convert(node):
            out=[]
            if not isinstance(node,Node): return out
            if node.tag in ('header','footer'): return out
            if node.tag in ('p','h2','h3'):
                style=h2 if node.tag=='h2' else h3 if node.tag=='h3' else lead if node.cls('lead') else small if node.cls('small') else body
                return [Paragraph(rich(node),style)]
            if node.tag in ('ol','ul'):
                for n,li in enumerate([c for c in node.children if isinstance(c,Node) and c.tag=='li'],1):
                    text=rich(li)
                    # Separate the bold step title from its explanatory span.
                    if node.cls('steps'): text=text.replace('</b>','</b><br/>',1)
                    out.append(Paragraph((str(n)+'. ' if node.tag=='ol' else '• ')+text,item))
                return out
            if node.tag=='table':
                rows=[]
                for row in node.all('tr'):
                    rows.append([Paragraph(rich(c),cell) for c in row.children if isinstance(c,Node) and c.tag in ('th','td')])
                table=Table(rows,colWidths=[136,375],hAlign='LEFT',repeatRows=1)
                table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eef4f3')),('LINEBELOW',(0,0),(-1,-1),.5,line),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
                return [table,Spacer(1,8)]
            if node.tag=='div' and (node.cls('note') or node.cls('formula')):
                content=Paragraph(rich(node),small)
                table=Table([[content]],colWidths=[511],hAlign='LEFT')
                table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#fff8e8' if node.cls('warning') else '#eef7f3')),('LINEBEFORE',(0,0),(0,0),3,colors.HexColor('#f4b941') if node.cls('warning') else green),('LEFTPADDING',(0,0),(-1,-1),11),('RIGHTPADDING',(0,0),(-1,-1),11),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
                return [Spacer(1,3),table,Spacer(1,9)]
            for child in node.children: out.extend(convert(child))
            return out
        for child in page.children: story.extend(convert(child))
    output=ROOT/'docs/Manual-de-uso.pdf'
    def decor(canvas,doc):
        width,height=A4
        canvas.setStrokeColor(line);canvas.setLineWidth(.6);canvas.line(42,38,width-42,38)
        canvas.setFont(font,7.5);canvas.setFillColor(colors.HexColor('#536570'))
        canvas.drawString(42,25,'Voz da Escola 2.0  |  Windows e Android  |  Uso offline')
        canvas.drawRightString(width-42,25,f'{doc.page} / {len(pages)}')
    doc=SimpleDocTemplate(str(output),pagesize=A4,rightMargin=42,leftMargin=42,topMargin=40,bottomMargin=49,title='Voz da Escola - Manual de uso',author='Voz da Escola')
    doc.build(story,onFirstPage=decor,onLaterPages=decor)
    print(output)
if __name__=='__main__': main()

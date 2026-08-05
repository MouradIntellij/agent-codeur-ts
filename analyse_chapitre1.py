import xml.etree.ElementTree as ET

def analyse_document_xml(path):
    tree = ET.parse(path)
    root = tree.getroot()
    print('Analyse du document XML :')
    for child in root:
        print(f'Élément: {child.tag}, Attributs: {child.attrib}')
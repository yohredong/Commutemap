var wms_layers = [];


        var lyr_EsriLightGray_0 = new ol.layer.Tile({
            'title': 'Esri Light Gray',
            'opacity': 1.000000,
            
            
            source: new ol.source.XYZ({
            attributions: ' ',
                url: 'https://server.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'
            })
        });
var format_Merged_1 = new ol.format.GeoJSON();
var features_Merged_1 = format_Merged_1.readFeatures(json_Merged_1, 
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_Merged_1 = new ol.source.Vector({
    attributions: ' ',
});
jsonSource_Merged_1.addFeatures(features_Merged_1);
var lyr_Merged_1 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_Merged_1, 
                style: style_Merged_1,
                popuplayertitle: 'Merged',
                interactive: true,
    title: 'Merged<br />\
    <img src="styles/legend/Merged_1_0.png" /> Bicycle to Sentul Depot pickleball with Adam<br />\
    <img src="styles/legend/Merged_1_1.png" /> Brompton bicycle commute from Bukit Bintang to BMI UniKLI, Gombak<br />\
    <img src="styles/legend/Merged_1_2.png" /> Brompton. Icon Residence - Bukit Bintang <br />\
    <img src="styles/legend/Merged_1_3.png" /> CarbonScore Roadshow #3, Petaling Jaya, UEM Edgenta<br />\
    <img src="styles/legend/Merged_1_4.png" /> Ken Yang office - Bangsar bicycle ride<br />\
    <img src="styles/legend/Merged_1_5.png" /> Morning Brompton bicycle commute<br />\
    <img src="styles/legend/Merged_1_6.png" /> Taman Desa bicycle ride <br />\
    <img src="styles/legend/Merged_1_7.png" /> <br />' });

lyr_EsriLightGray_0.setVisible(true);lyr_Merged_1.setVisible(true);
var layersList = [lyr_EsriLightGray_0,lyr_Merged_1];
lyr_Merged_1.set('fieldAliases', {'name': 'name', 'cmt': 'cmt', 'desc': 'desc', 'src': 'src', 'link1_href': 'link1_href', 'link1_text': 'link1_text', 'link1_type': 'link1_type', 'link2_href': 'link2_href', 'link2_text': 'link2_text', 'link2_type': 'link2_type', 'number': 'number', 'type': 'type', 'layer': 'layer', 'path': 'path', 'User': 'User', });
lyr_Merged_1.set('fieldImages', {'name': 'TextEdit', 'cmt': 'TextEdit', 'desc': 'TextEdit', 'src': 'TextEdit', 'link1_href': 'TextEdit', 'link1_text': 'TextEdit', 'link1_type': 'TextEdit', 'link2_href': 'TextEdit', 'link2_text': 'TextEdit', 'link2_type': 'TextEdit', 'number': 'Range', 'type': 'TextEdit', 'layer': 'TextEdit', 'path': 'TextEdit', 'User': '', });
lyr_Merged_1.set('fieldLabels', {'name': 'no label', 'cmt': 'no label', 'desc': 'no label', 'src': 'no label', 'link1_href': 'no label', 'link1_text': 'no label', 'link1_type': 'no label', 'link2_href': 'no label', 'link2_text': 'no label', 'link2_type': 'no label', 'number': 'no label', 'type': 'no label', 'layer': 'no label', 'path': 'no label', 'User': 'no label', });
lyr_Merged_1.on('precompose', function(evt) {
    evt.context.globalCompositeOperation = 'normal';
});
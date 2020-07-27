'use strict';
'require uci';
'require form';
'require network';
'require baseclass';
'require validation';
'require tools.widgets as widgets';

function validateAddr(section_id, value) {
	if (value == '')
		return true;

	var ipv6 = /6$/.test(this.section.formvalue(section_id, 'mode')),
	    addr = ipv6 ? validation.parseIPv6(value) : validation.parseIPv4(value);

	return addr ? true : (ipv6 ? _('Expecting a valid IPv6 address') : _('Expecting a valid IPv4 address'));
}

function setIfActive(section_id, value) {
	if (this.isActive(section_id)) {
		uci.set('network', section_id, this.ucioption, value);

		/* Requires http://lists.openwrt.org/pipermail/openwrt-devel/2020-July/030397.html */
		if (false && this.option == 'ifname_multi') {
			var devname = this.section.formvalue(section_id, 'name_complex'),
			    m = devname ? devname.match(/^br-([A-Za-z0-9_]+)$/) : null;

			if (m && uci.get('network', m[1], 'type') == 'bridge') {
				uci.set('network', m[1], 'ifname', devname);
				uci.unset('network', m[1], 'type');
			}
		}
	}
}

function validateQoSMap(section_id, value) {
	if (value == '')
		return true;

	var m = value.match(/^(\d+):(\d+)$/);

	if (!m || +m[1] > 0xFFFFFFFF || +m[2] > 0xFFFFFFFF)
		return _('Expecting two priority values separated by a colon');

	return true;
}

function deviceSectionExists(section_id, devname) {
	var exists = false;

	uci.sections('network', 'device', function(ss) {
		exists = exists || (ss['.name'] != section_id && ss.name == devname /* && !ss.type*/);
	});

	/* Until http://lists.openwrt.org/pipermail/openwrt-devel/2020-July/030397.html lands,
	   prevent redeclaring interface bridges */
	if (!exists) {
		var m = devname.match(/^br-([A-Za-z0-9_]+)$/),
		    s = m ? uci.get('network', m[1]) : null;

		if (s && s['.type'] == 'interface' && s.type == 'bridge')
			exists = true;
	}

	return exists;
}

function isBridgePort(dev) {
	if (!dev)
		return false;

	if (dev.isBridgePort())
		return true;

	var isPort = false;

	uci.sections('network', null, function(s) {
		if (s['.type'] != 'interface' && s['.type'] != 'device')
			return;

		if (s.type == 'bridge' && L.toArray(s.ifname).indexOf(dev.getName()) > -1)
			isPort = true;
	});

	return isPort;
}

function lookupDevName(s, section_id) {
	var typeui = s.getUIElement(section_id, 'type'),
	    typeval = typeui ? typeui.getValue() : s.cfgvalue(section_id, 'type'),
	    ifnameui = s.getUIElement(section_id, 'ifname_single'),
	    ifnameval = ifnameui ? ifnameui.getValue() : s.cfgvalue(section_id, 'ifname_single');

	return (typeval == 'bridge') ? 'br-%s'.format(section_id) : ifnameval;
}

function lookupDevSection(s, section_id, autocreate) {
	var devname = lookupDevName(s, section_id),
	    devsection = null;

	uci.sections('network', 'device', function(ds) {
		if (ds.name == devname)
			devsection = ds['.name'];
	});

	if (autocreate && !devsection) {
		devsection = uci.add('network', 'device');
		uci.set('network', devsection, 'name', devname);
	}

	return devsection;
}

function getDeviceValue(dev, method) {
	if (dev && dev.getL3Device)
		dev = dev.getL3Device();

	if (dev && typeof(dev[method]) == 'function')
		return dev[method].apply(dev);

	return '';
}

function deviceCfgValue(section_id) {
	if (arguments.length == 2)
		return;

	var ds = lookupDevSection(this.section, section_id, false);

	return (ds ? uci.get('network', ds, this.option) : null) ||
		uci.get('network', section_id, this.option) ||
		this.default;
}

function deviceWrite(section_id, formvalue) {
	var ds = lookupDevSection(this.section, section_id, true);

	uci.set('network', ds, this.option, formvalue);
	uci.unset('network', section_id, this.option);
}

function deviceRemove(section_id) {
	var ds = lookupDevSection(this.section, section_id, false),
	    sv = ds ? uci.get('network', ds) : null;

	if (sv) {
		var empty = true;

		for (var opt in sv) {
			if (opt.charAt(0) == '.' || opt == 'name' || opt == this.option)
				continue;

			empty = false;
		}

		if (empty)
			uci.remove('network', ds);
	}

	uci.unset('network', section_id, this.option);
}

function deviceRefresh(section_id) {
	var dev = network.instantiateDevice(lookupDevName(this.section, section_id)),
	    uielem = this.getUIElement(section_id);

	if (uielem) {
		switch (this.option) {
		case 'mtu':
		case 'mtu6':
			uielem.setPlaceholder(dev.getMTU());
			break;

		case 'macaddr':
			uielem.setPlaceholder(dev.getMAC());
			break;
		}

		uielem.setValue(this.cfgvalue(section_id));
	}
}

return baseclass.extend({
	replaceOption: function(s, tabName, optionClass, optionName, optionTitle, optionDescription) {
		var o = s.getOption(optionName);

		if (o) {
			if (o.tab) {
				s.tabs[o.tab].children = s.tabs[o.tab].children.filter(function(opt) {
					return opt.option != optionName;
				});
			}

			s.children = s.children.filter(function(opt) {
				return opt.option != optionName;
			});
		}

		return s.taboption(tabName, optionClass, optionName, optionTitle, optionDescription);
	},

	addOption: function(s, tabName, optionClass, optionName, optionTitle, optionDescription) {
		var o = this.replaceOption(s, tabName, optionClass, optionName, optionTitle, optionDescription);

		if (s.sectiontype == 'interface' && optionName != 'type' && optionName != 'vlan_filtering') {
			o.cfgvalue = deviceCfgValue;
			o.write = deviceWrite;
			o.remove = deviceRemove;
			o.refresh = deviceRefresh;
		}

		return o;
	},

	addDeviceOptions: function(s, dev, isNew) {
		var isIface = (s.sectiontype == 'interface'),
		    ifc = isIface ? network.instantiateNetwork(s.section) : null,
		    gensection = ifc ? 'physical' : 'devgeneral',
		    advsection = ifc ? 'physical' : 'devadvanced',
		    simpledep = ifc ? { type: '', ifname_single: /^[^@]/ } : { type: '' },
		    o, ss;

		if (isIface) {
			var type;

			type = this.addOption(s, gensection, form.Flag, 'type', _('Bridge interfaces'), _('Creates a bridge over specified interface(s)'));
			type.modalonly = true;
			type.disabled = '';
			type.enabled = 'bridge';
			type.write = type.remove = function(section_id, value) {
				var protoname = this.section.formvalue(section_id, 'proto'),
				    protocol = network.getProtocol(protoname),
				    new_ifnames = this.isActive(section_id) ? L.toArray(this.section.formvalue(section_id, value ? 'ifname_multi' : 'ifname_single')) : [];

				if (!protocol.isVirtual() && !this.isActive(section_id))
					return;

				var old_ifnames = [],
				    devs = ifc.getDevices() || L.toArray(ifc.getDevice());

				for (var i = 0; i < devs.length; i++)
					old_ifnames.push(devs[i].getName());

				if (!value)
					new_ifnames.length = Math.max(new_ifnames.length, 1);

				old_ifnames.sort();
				new_ifnames.sort();

				for (var i = 0; i < Math.max(old_ifnames.length, new_ifnames.length); i++) {
					if (old_ifnames[i] != new_ifnames[i]) {
						// backup_ifnames()
						for (var j = 0; j < old_ifnames.length; j++)
							ifc.deleteDevice(old_ifnames[j]);

						for (var j = 0; j < new_ifnames.length; j++)
							ifc.addDevice(new_ifnames[j]);

						break;
					}
				}

				if (value)
					uci.set('network', section_id, 'type', 'bridge');
				else
					uci.unset('network', section_id, 'type');
			};
		}
		else {
			s.tab('devgeneral', _('General device options'));
			s.tab('devadvanced', _('Advanced device options'));
			s.tab('brport', _('Bridge port specific options'));
			s.tab('bridgevlan', _('Bridge VLAN filtering'));

			o = this.addOption(s, gensection, form.ListValue, 'type', _('Device type'));
			o.readonly = !isNew;
			o.value('', _('Network device'));
			o.value('bridge', _('Bridge device'));
			o.value('8021q', _('VLAN (802.1q)'));
			o.value('8021ad', _('VLAN (802.1ad)'));
			o.value('macvlan', _('MAC VLAN'));
			o.value('veth', _('Virtual Ethernet'));

			o = this.addOption(s, gensection, widgets.DeviceSelect, 'name_simple', _('Existing device'));
			o.readonly = !isNew;
			o.rmempty = false;
			o.noaliases = true;
			o.default = (dev ? dev.getName() : '');
			o.ucioption = 'name';
			o.write = o.remove = setIfActive;
			o.filter = function(section_id, value) {
				return !deviceSectionExists(section_id, value);
			};
			o.validate = function(section_id, value) {
				return deviceSectionExists(section_id, value) ? _('A configuration for the device "%s" already exists').format(value) : true;
			};
			o.depends('type', '');
		}

		o = this.addOption(s, gensection, widgets.DeviceSelect, 'ifname_single', isIface ? _('Interface') : _('Base device'));
		o.readonly = !isNew;
		o.rmempty = false;
		o.noaliases = !isIface;
		o.default = (dev ? dev.getName() : '').match(/^.+\.\d+$/) ? dev.getName().replace(/\.\d+$/, '') : '';
		o.ucioption = 'ifname';
		o.validate = function(section_id, value) {
			var type = this.section.formvalue(section_id, 'type'),
			    name = this.section.getUIElement(section_id, 'name_complex');

			if (type == 'macvlan' && value && name && !name.isChanged()) {
				var i = 0;

				while (deviceSectionExists(section_id, '%smac%d'.format(value, i)))
					i++;

				name.setValue('%smac%d'.format(value, i));
				name.triggerValidation();
			}

			return true;
		};
		if (isIface) {
			o.write = o.remove = function() {};
			o.cfgvalue = function(section_id) {
				return (ifc.getDevices() || L.toArray(ifc.getDevice())).map(function(dev) {
					return dev.getName();
				});
			};
			o.onchange = function(ev, section_id, values) {
				for (var i = 0, co; (co = this.section.children[i]) != null; i++)
					if (co !== this && co.refresh)
						co.refresh(section_id);

			};
			o.depends('type', '');
		}
		else {
			o.write = o.remove = setIfActive;
			o.depends('type', '8021q');
			o.depends('type', '8021ad');
			o.depends('type', 'macvlan');
		}

		o = this.addOption(s, gensection, form.Value, 'vid', _('VLAN ID'));
		o.readonly = !isNew;
		o.datatype = 'range(1, 4094)';
		o.rmempty = false;
		o.default = (dev ? dev.getName() : '').match(/^.+\.\d+$/) ? dev.getName().replace(/^.+\./, '') : '';
		o.validate = function(section_id, value) {
			var base = this.section.formvalue(section_id, 'ifname_single'),
			    vid = this.section.formvalue(section_id, 'vid'),
			    name = this.section.getUIElement(section_id, 'name_complex');

			if (base && vid && name && !name.isChanged()) {
				name.setValue('%s.%d'.format(base, vid));
				name.triggerValidation();
			}

			return true;
		};
		o.depends('type', '8021q');
		o.depends('type', '8021ad');

		o = this.addOption(s, gensection, form.ListValue, 'mode', _('Mode'));
		o.value('vepa', _('VEPA (Virtual Ethernet Port Aggregator)', 'MACVLAN mode'));
		o.value('private', _('Private (Prevent communication between MAC VLANs)', 'MACVLAN mode'));
		o.value('bridge', _('Bridge (Support direct communication between MAC VLANs)', 'MACVLAN mode'));
		o.value('passthru', _('Pass-through (Mirror physical device to single MAC VLAN)', 'MACVLAN mode'));
		o.depends('type', 'macvlan');

		if (!isIface) {
			o = this.addOption(s, gensection, form.Value, 'name_complex', _('Device name'));
			o.rmempty = false;
			o.datatype = 'maxlength(15)';
			o.readonly = !isNew;
			o.ucioption = 'name';
			o.write = o.remove = setIfActive;
			o.validate = function(section_id, value) {
				return deviceSectionExists(section_id, value) ? _('The device name "%s" is already taken').format(value) : true;
			};
			o.depends({ type: '', '!reverse': true });
		}

		o = this.addOption(s, advsection, form.DynamicList, 'ingress_qos_mapping', _('Ingress QoS mapping'), _('Defines a mapping of VLAN header priority to the Linux internal packet priority on incoming frames'));
		o.rmempty = true;
		o.validate = validateQoSMap;
		o.depends('type', '8021q');
		o.depends('type', '8021ad');

		o = this.addOption(s, advsection, form.DynamicList, 'egress_qos_mapping', _('Egress QoS mapping'), _('Defines a mapping of Linux internal packet priority to VLAN header priority but for outgoing frames'));
		o.rmempty = true;
		o.validate = validateQoSMap;
		o.depends('type', '8021q');
		o.depends('type', '8021ad');

		o = this.addOption(s, gensection, widgets.DeviceSelect, 'ifname_multi', _('Bridge ports'));
		o.size = 10;
		o.rmempty = true;
		o.multiple = true;
		o.noaliases = true;
		o.nobridges = true;
		o.ucioption = 'ifname';
		if (isIface) {
			o.write = o.remove = function() {};
			o.cfgvalue = function(section_id) {
				return (ifc.getDevices() || L.toArray(ifc.getDevice())).map(function(dev) { return dev.getName() });
			};
		}
		else {
			o.write = o.remove = setIfActive;
			o.default = L.toArray(dev ? dev.getPorts() : null).filter(function(p) { return p.getType() != 'wifi' || p.isUp() }).map(function(p) { return p.getName() });
			o.filter = function(section_id, device_name) {
				var d = network.instantiateDevice(device_name);
				return d.getType() != 'wifi' || d.isUp();
			};
		}
		o.onchange = function(ev, section_id, values) {
			ss.updatePorts(values);

			return ss.parse().then(function() {
				ss.redraw();
			});
		};
		o.depends('type', 'bridge');

		o = this.addOption(s, gensection, form.Flag, 'bridge_empty', _('Bring up empty bridge'), _('Bring up the bridge interface even if no ports are attached'));
		o.default = o.disabled;
		o.depends('type', 'bridge');

		o = this.addOption(s, advsection, form.Value, 'priority', _('Priority'));
		o.placeholder = '32767';
		o.datatype = 'range(0, 65535)';
		o.depends('type', 'bridge');

		o = this.addOption(s, advsection, form.Value, 'ageing_time', _('Ageing time'), _('Timeout in seconds for learned MAC addresses in the forwarding database'));
		o.placeholder = '30';
		o.datatype = 'uinteger';
		o.depends('type', 'bridge');

		o = this.addOption(s, advsection, form.Flag, 'stp', _('Enable <abbr title="Spanning Tree Protocol">STP</abbr>'), _('Enables the Spanning Tree Protocol on this bridge'));
		o.default = o.disabled;
		o.depends('type', 'bridge');

		o = this.addOption(s, advsection, form.Value, 'hello_time', _('Hello interval'), _('Interval in seconds for STP hello packets'));
		o.placeholder = '2';
		o.datatype = 'range(1, 10)';
		o.depends({ type: 'bridge', stp: '1' });

		o = this.addOption(s, advsection, form.Value, 'forward_delay', _('Forward delay'), _('Time in seconds to spend in listening and learning states'));
		o.placeholder = '15';
		o.datatype = 'range(2, 30)';
		o.depends({ type: 'bridge', stp: '1' });

		o = this.addOption(s, advsection, form.Value, 'max_age', _('Maximum age'), _('Timeout in seconds until topology updates on link loss'));
		o.placeholder = '20';
		o.datatype = 'range(6, 40)';
		o.depends({ type: 'bridge', stp: '1' });


		o = this.addOption(s, advsection, form.Flag, 'igmp_snooping', _('Enable <abbr title="Internet Group Management Protocol">IGMP</abbr> snooping'), _('Enables IGMP snooping on this bridge'));
		o.default = o.disabled;
		o.depends('type', 'bridge');

		o = this.addOption(s, advsection, form.Value, 'hash_max', _('Maximum snooping table size'));
		o.placeholder = '512';
		o.datatype = 'uinteger';
		o.depends({ type: 'bridge', igmp_snooping: '1' });

		o = this.addOption(s, advsection, form.Flag, 'multicast_querier', _('Enable multicast querier'));
		o.defaults = { '1': [{'igmp_snooping': '1'}], '0': [{'igmp_snooping': '0'}] };
		o.depends('type', 'bridge');

		o = this.addOption(s, advsection, form.Value, 'robustness', _('Robustness'), _('The robustness value allows tuning for the expected packet loss on the network. If a network is expected to be lossy, the robustness value may be increased. IGMP is robust to (Robustness-1) packet losses'));
		o.placeholder = '2';
		o.datatype = 'min(1)';
		o.depends({ type: 'bridge', multicast_querier: '1' });

		o = this.addOption(s, advsection, form.Value, 'query_interval', _('Query interval'), _('Interval in centiseconds between multicast general queries. By varying the value, an administrator may tune the number of IGMP messages on the subnet; larger values cause IGMP Queries to be sent less often'));
		o.placeholder = '12500';
		o.datatype = 'uinteger';
		o.depends({ type: 'bridge', multicast_querier: '1' });

		o = this.addOption(s, advsection, form.Value, 'query_response_interval', _('Query response interval'), _('The max response time in centiseconds inserted into the periodic general queries. By varying the value, an administrator may tune the burstiness of IGMP messages on the subnet; larger values make the traffic less bursty, as host responses are spread out over a larger interval'));
		o.placeholder = '1000';
		o.datatype = 'uinteger';
		o.validate = function(section_id, value) {
			var qiopt = L.toArray(this.map.lookupOption('query_interval', section_id))[0],
			    qival = qiopt ? (qiopt.formvalue(section_id) || qiopt.placeholder) : '';

			if (value != '' && qival != '' && +value >= +qival)
				return _('The query response interval must be lower than the query interval value');

			return true;
		};
		o.depends({ type: 'bridge', multicast_querier: '1' });

		o = this.addOption(s, advsection, form.Value, 'last_member_interval', _('Last member interval'), _('The max response time in centiseconds inserted into group-specific queries sent in response to leave group messages. It is also the amount of time between group-specific query messages. This value may be tuned to modify the "leave latency" of the network. A reduced value results in reduced time to detect the loss of the last member of a group'));
		o.placeholder = '100';
		o.datatype = 'uinteger';
		o.depends({ type: 'bridge', multicast_querier: '1' });

		o = this.addOption(s, gensection, form.Value, 'mtu', _('MTU'));
		o.placeholder = getDeviceValue(ifc || dev, 'getMTU');
		o.datatype = 'max(9200)';
		o.depends(simpledep);

		o = this.addOption(s, gensection, form.Value, 'macaddr', _('MAC address'));
		o.placeholder = getDeviceValue(ifc || dev, 'getMAC');
		o.datatype = 'macaddr';
		o.depends(simpledep);
		o.depends('type', 'macvlan');
		o.depends('type', 'veth');

		o = this.addOption(s, gensection, form.Value, 'peer_name', _('Peer device name'));
		o.rmempty = true;
		o.datatype = 'maxlength(15)';
		o.depends('type', 'veth');
		o.load = function(section_id) {
			var sections = uci.sections('network', 'device'),
			    idx = 0;

			for (var i = 0; i < sections.length; i++)
				if (sections[i]['.name'] == section_id)
					break;
				else if (sections[i].type == 'veth')
					idx++;

			this.placeholder = 'veth%d'.format(idx);

			return form.Value.prototype.load.apply(this, arguments);
		};

		o = this.addOption(s, gensection, form.Value, 'peer_macaddr', _('Peer MAC address'));
		o.rmempty = true;
		o.datatype = 'macaddr';
		o.depends('type', 'veth');

		o = this.addOption(s, gensection, form.Value, 'txqueuelen', _('TX queue length'));
		o.placeholder = dev ? dev._devstate('qlen') : '';
		o.datatype = 'uinteger';
		o.depends(simpledep);

		o = this.addOption(s, advsection, form.Flag, 'promisc', _('Enable promiscious mode'));
		o.default = o.disabled;
		o.depends(simpledep);

		o = this.addOption(s, advsection, form.ListValue, 'rpfilter', _('Reverse path filter'));
		o.default = '';
		o.value('', _('disabled'));
		o.value('loose', _('Loose filtering'));
		o.value('strict', _('Strict filtering'));
		o.cfgvalue = function(section_id) {
			var val = form.ListValue.prototype.cfgvalue.apply(this, [section_id]);

			switch (val || '') {
			case 'loose':
			case '1':
				return 'loose';

			case 'strict':
			case '2':
				return 'strict';

			default:
				return '';
			}
		};
		o.depends(simpledep);

		o = this.addOption(s, advsection, form.Flag, 'acceptlocal', _('Accept local'), _('Accept packets with local source addresses'));
		o.default = o.disabled;
		o.depends(simpledep);

		o = this.addOption(s, advsection, form.Flag, 'sendredirects', _('Send ICMP redirects'));
		o.default = o.enabled;
		o.depends(simpledep);

		o = this.addOption(s, advsection, form.Value, 'neighreachabletime', _('Neighbour cache validity'), _('Time in milliseconds'));
		o.placeholder = '30000';
		o.datatype = 'uinteger';
		o.depends(simpledep);

		o = this.addOption(s, advsection, form.Value, 'neighgcstaletime', _('Stale neighbour cache timeout'), _('Timeout in seconds'));
		o.placeholder = '60';
		o.datatype = 'uinteger';
		o.depends(simpledep);

		o = this.addOption(s, advsection, form.Value, 'neighlocktime', _('Minimum ARP validity time'), _('Minimum required time in seconds before an ARP entry may be replaced. Prevents ARP cache thrashing.'));
		o.placeholder = '0';
		o.datatype = 'uinteger';
		o.depends(simpledep);

		o = this.addOption(s, gensection, form.Flag, 'ipv6', _('Enable IPv6'));
		o.default = o.enabled;
		o.depends(simpledep);

		o = this.addOption(s, gensection, form.Value, 'mtu6', _('IPv6 MTU'));
		o.placeholder = getDeviceValue(ifc || dev, 'getMTU');
		o.datatype = 'max(9200)';
		o.depends(Object.assign({ ipv6: '1' }, simpledep));

		o = this.addOption(s, gensection, form.Value, 'dadtransmits', _('DAD transmits'), _('Amount of Duplicate Address Detection probes to send'));
		o.placeholder = '1';
		o.datatype = 'uinteger';
		o.depends(Object.assign({ ipv6: '1' }, simpledep));


		o = this.addOption(s, advsection, form.Flag, 'multicast', _('Enable multicast support'));
		o.default = o.enabled;
		o.depends(simpledep);

		o = this.addOption(s, advsection, form.ListValue, 'igmpversion', _('Force IGMP version'));
		o.value('', _('No enforcement'));
		o.value('1', _('Enforce IGMPv1'));
		o.value('2', _('Enforce IGMPv2'));
		o.value('3', _('Enforce IGMPv3'));
		o.depends(Object.assign({ multicast: '1' }, simpledep));

		o = this.addOption(s, advsection, form.ListValue, 'mldversion', _('Force MLD version'));
		o.value('', _('No enforcement'));
		o.value('1', _('Enforce MLD version 1'));
		o.value('2', _('Enforce MLD version 2'));
		o.depends(Object.assign({ multicast: '1' }, simpledep));

		if (isBridgePort(dev)) {
			o = this.addOption(s, 'brport', form.Flag, 'learning', _('Enable MAC address learning'));
			o.default = o.enabled;
			o.depends(simpledep);

			o = this.addOption(s, 'brport', form.Flag, 'unicast_flood', _('Enable unicast flooding'));
			o.default = o.enabled;
			o.depends(simpledep);

			o = this.addOption(s, 'brport', form.Flag, 'isolated', _('Port isolation'), _('Only allow communication with non-isolated bridge ports when enabled'));
			o.default = o.disabled;
			o.depends(simpledep);

			o = this.addOption(s, 'brport', form.ListValue, 'multicast_router', _('Multicast routing'));
			o.value('', _('Never'));
			o.value('1', _('Learn'));
			o.value('2', _('Always'));
			o.depends(Object.assign({ multicast: '1' }, simpledep));

			o = this.addOption(s, 'brport', form.Flag, 'multicast_to_unicast', _('Multicast to unicast'), _('Forward multicast packets as unicast packets on this device.'));
			o.default = o.disabled;
			o.depends(Object.assign({ multicast: '1' }, simpledep));

			o = this.addOption(s, 'brport', form.Flag, 'multicast_fast_leave', _('Enable multicast fast leave'));
			o.default = o.disabled;
			o.depends(Object.assign({ multicast: '1' }, simpledep));
		}
	}
});